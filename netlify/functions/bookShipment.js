/**
 * bookShipment.js
 * Creates a Courier Guy (Shiplogic) shipment/waybill for a paid order.
 * Endpoint: POST https://api.portal.thecourierguy.co.za/shipments
 *
 * Uses Node's https module (same as payfast-notify.js, which works) rather than
 * global fetch/undici — the fetch version crashed the Netlify runtime on this call.
 *
 * Auth: admin-triggered calls must pass adminKey === ADMIN_ORDER_KEY.
 * Env: TCG_API_KEY (booking-capable portal key), ADMIN_ORDER_KEY.
 */

const https = require('https');

const TCG_HOST = 'api.portal.thecourierguy.co.za';
const TCG_PATH = '/shipments';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Roastery collection point (matches getShipping.js)
const COLLECTION = {
  type: 'business',
  company: 'Artifacts Coffee Roastery',
  street_address: '864 Bongo Street',
  local_area: 'Allens Nek',
  city: 'Roodepoort',
  zone: 'Gauteng',
  country: 'ZA',
  code: '1709',
};
const COLLECTION_CONTACT = {
  name: 'Artifacts Coffee',
  mobile_number: '0613832478',
  email: 'hello@artifactscoffee.co.za',
};

function parcelForKg(kg) {
  const w = Math.max(Number(kg) || 1, 0.1);
  let dims;
  if (w <= 0.2)      dims = { l: 20, wd: 14, h: 4 };
  else if (w <= 0.5) dims = { l: 25, wd: 16, h: 6 };
  else if (w <= 1.5) dims = { l: 32, wd: 22, h: 9 };
  else               dims = { l: 40, wd: 28, h: 12 };
  return {
    parcel_description: 'Coffee',
    submitted_length_cm: dims.l,
    submitted_width_cm: dims.wd,
    submitted_height_cm: dims.h,
    submitted_weight_kg: w,
  };
}

// Next collection date (skip weekends), ISO at midnight UTC
function nextCollectionDate() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);      // Sat -> Mon
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun -> Mon
  return d.toISOString();
}

// HTTPS POST with JSON body — resolves { status, body } (never rejects on HTTP error)
function postJson(bodyStr, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: TCG_HOST,
        path: TCG_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  try {
    if (!process.env.ADMIN_ORDER_KEY || body.adminKey !== process.env.ADMIN_ORDER_KEY) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const key = process.env.TCG_API_KEY;
    if (!key) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'TCG_API_KEY not set' }) };

    const { delivery = {}, contact = {}, weightKg = 1, declaredValue = 100, serviceLevelCode, reference, instructions } = body;
    if (!delivery.street_address || !delivery.code || !serviceLevelCode) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing delivery address, postal code, or service level' }) };
    }

    const payload = {
      collection_address: COLLECTION,
      collection_contact: COLLECTION_CONTACT,
      delivery_address: {
        type: delivery.type || 'residential',
        company: delivery.company || '',
        street_address: delivery.street_address,
        local_area: delivery.local_area || delivery.city || '',
        city: delivery.city || '',
        zone: delivery.zone || '',
        code: String(delivery.code),
        country: 'ZA',
      },
      delivery_contact: {
        name: contact.name || '',
        mobile_number: contact.mobile_number || '',
        email: contact.email || '',
      },
      parcels: [parcelForKg(weightKg)],
      declared_value: Number(declaredValue) || 100,
      collection_min_date: nextCollectionDate(),
      service_level_code: serviceLevelCode,
      customer_reference_name: 'Order no.',
      customer_reference: reference || '',
      special_instructions_collection: instructions || '',
      mute_notifications: false,
    };

    if (body.dryRun) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, dryRun: true, endpoint: `https://${TCG_HOST}${TCG_PATH}`, payload }) };
    }

    const started = Date.now();
    let resp;
    try {
      resp = await postJson(JSON.stringify(payload), key);
    } catch (e) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: false, error: 'TCG request error', detail: (e && e.message) || String(e) }) };
    }
    const elapsedMs = Date.now() - started;

    let data;
    try { data = JSON.parse(resp.body); } catch { data = { raw: (resp.body || '').slice(0, 600) }; }

    if (!resp.status || resp.status < 200 || resp.status >= 300) {
      console.error('TCG booking failed:', resp.status, resp.body);
      // Return 200 (not 5xx) so Cloudflare doesn't replace the body with its own error page
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: false, error: 'Booking failed', status: resp.status, ms: elapsedMs, detail: data }) };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        success: true,
        ms: elapsedMs,
        shipment_id: data.id || data.shipment_id || null,
        tracking_reference: data.tracking_reference || data.short_tracking_reference || null,
        short_tracking_reference: data.short_tracking_reference || null,
      }),
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('bookShipment error:', msg);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: false, error: 'Booking request error', detail: msg }) };
  }
};
