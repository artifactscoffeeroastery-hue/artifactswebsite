/**
 * bookShipment.js
 * Creates a courier shipment (waybill) for a paid order via Bob Go.
 *
 * Endpoint: POST https://api.bobgo.co.za/v2/shipments
 *
 * Bob Go aggregates all couriers (The Courier Guy, RAM, SkyNet, Fastway,
 * Internet Express, MTE Xpress...), so we quote AND book through the same
 * provider. This file previously booked directly against The Courier Guy's
 * own portal API, which meant a customer could be quoted a RAM rate that we
 * then physically could not book — the service level codes belong to
 * different carriers and TCG's API has no idea what `ES` (RAM Economy) is.
 *
 * IMPORTANT: the parcel dimensions/weight sent here must match what
 * getShipping.js quoted, otherwise Bob Go re-bills on the actual parcel and
 * the customer's shipping charge won't cover it. Both files share the same
 * parcel-sizing logic — keep `parcelForKg()` in sync between them.
 *
 * Required env vars:
 *   BOBGO_API_KEY   – Bob Go Sales Channel API key (same key getShipping.js uses)
 *   ADMIN_ORDER_KEY – secret gate code, for admin-triggered bookings
 */

const BOBGO_API = 'https://api.bobgo.co.za/v2/shipments';
const BOBGO_KEY = process.env.BOBGO_API_KEY;
const CHANNEL_ID = 'artifactscoffee.co.za';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Roastery collection point (must match getShipping.js COLLECTION)
const COLLECTION = {
  company:        'Artifacts Coffee Roastery',
  street_address: '864 Bongo Street',
  local_area:     'Allens Nek',
  city:           'Roodepoort',
  zone:           'Gauteng',
  country:        'ZA',
  code:           '1709',
};
const COLLECTION_CONTACT = {
  name:   'Artifacts Coffee',
  mobile: '0613832478',
  email:  'hello@artifactscoffee.co.za',
};

// Bob Go submission statuses (from their API)
const RETRYABLE_STATUSES = ['pending-rates', 'pending-submission', 'failed-will-retry'];
const FAILED_STATUSES    = ['no-rates', 'failed-indefinitely'];

/**
 * Parcel sizing — MUST match getShipping.js weightKgToParcel() exactly, or the
 * rate we quoted won't be the rate Bob Go bills us for.
 */
function parcelForKg(kg) {
  const w = Math.max(Number(kg) || 0.1, 0.1);
  if (w <= 0.2) return { description: 'Coffee', submitted_length_cm: 20, submitted_width_cm: 14, submitted_height_cm: 4,  submitted_weight_kg: w };
  if (w <= 0.5) return { description: 'Coffee', submitted_length_cm: 25, submitted_width_cm: 16, submitted_height_cm: 6,  submitted_weight_kg: w };
  if (w <= 1.5) return { description: 'Coffee', submitted_length_cm: 32, submitted_width_cm: 22, submitted_height_cm: 9,  submitted_weight_kg: w };
  return              { description: 'Coffee', submitted_length_cm: 40, submitted_width_cm: 28, submitted_height_cm: 12, submitted_weight_kg: w };
}

/** Next weekday, ISO at midnight UTC — couriers don't collect on weekends */
function nextCollectionDate() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);      // Sat -> Mon
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun -> Mon
  return d.toISOString();
}

/**
 * Book a shipment with Bob Go. Exported so payfast-notify.js can auto-book on
 * paid orders without an HTTP round-trip back to this function.
 *
 * Returns { success, ...details } and never throws — callers treat a failed
 * booking as non-fatal (the order itself is still valid and paid).
 */
async function bookWithBobGo({ delivery, contact, weightKg, declaredValue, serviceLevelCode, providerSlug, reference, instructions }) {
  if (!BOBGO_KEY) return { success: false, error: 'BOBGO_API_KEY not set' };
  if (!delivery || !delivery.street_address || !delivery.code) {
    return { success: false, error: 'Missing delivery address or postal code' };
  }
  if (!serviceLevelCode || !providerSlug) {
    return { success: false, error: 'Missing courier service level / provider slug' };
  }

  const payload = {
    collection_address: COLLECTION,
    collection_contact_name:          COLLECTION_CONTACT.name,
    collection_contact_mobile_number: COLLECTION_CONTACT.mobile,
    collection_contact_email:         COLLECTION_CONTACT.email,
    delivery_address: {
      company:        delivery.company || '',
      street_address: delivery.street_address,
      local_area:     delivery.local_area || delivery.city || '',
      city:           delivery.city || '',
      zone:           delivery.zone || '',
      country:        'ZA',
      code:           String(delivery.code),
    },
    delivery_contact_name:          contact?.name   || '',
    delivery_contact_mobile_number: contact?.mobile || '',
    delivery_contact_email:         contact?.email  || '',
    parcels:            [parcelForKg(weightKg)],
    declared_value:     Number(declaredValue) || 100,
    service_level_code: serviceLevelCode,
    provider_slug:      providerSlug,
    collection_min_date: nextCollectionDate(),
    timeout: 10000,
  };
  if (reference) {
    payload.custom_tracking_reference = reference;
    payload.custom_order_number = reference;
  }
  if (instructions) payload.special_instructions_collection = instructions;

  let res, text;
  try {
    res = await fetch(BOBGO_API, {
      method: 'POST',
      headers: {
        'Content-Type':             'application/json',
        Authorization:              `Bearer ${BOBGO_KEY}`,
        'bobgo-channel-identifier': CHANNEL_ID,
      },
      body: JSON.stringify(payload),
    });
    text = await res.text();
  } catch (e) {
    console.error('Bob Go booking fetch error:', e.message);
    return { success: false, error: 'Could not reach Bob Go', detail: e.message };
  }

  let data;
  try { data = JSON.parse(text); } catch { data = { raw: (text || '').slice(0, 600) }; }

  if (!res.ok) {
    console.error('Bob Go booking failed:', res.status, (text || '').slice(0, 600));
    return { success: false, error: 'Booking rejected by Bob Go', status: res.status, detail: data };
  }

  // Bob Go can accept the request but still fail to submit to the courier —
  // e.g. "Insufficient funds. Make a payment to top up your account".
  const submission = data.submission_status;
  if (FAILED_STATUSES.includes(submission)) {
    console.error('Bob Go submission failed:', submission, data.failed_reason);
    return {
      success: false,
      error: data.failed_reason || `Bob Go submission failed (${submission})`,
      submission_status: submission,
      detail: data,
    };
  }

  const result = {
    success: true,
    pending: RETRYABLE_STATUSES.includes(submission),
    submission_status:   submission || null,
    shipment_id:         data.id || null,
    tracking_reference:  data.tracking_reference || data.short_tracking_reference || null,
    tracking_url:        data.tracking_url || null,
    provider_name:       data.provider_name || providerSlug,
    service_level_code:  data.service_level_code || serviceLevelCode,
    rate:                data.rate != null ? data.rate : null,
  };
  console.log(`Bob Go shipment booked: ${result.tracking_reference || result.shipment_id} (${result.provider_name}, ${submission || 'submitted'})`);
  return result;
}

exports.bookWithBobGo = bookWithBobGo;
exports.parcelForKg   = parcelForKg;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!process.env.ADMIN_ORDER_KEY || body.adminKey !== process.env.ADMIN_ORDER_KEY) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Dry run: show exactly what we'd send, without booking (and without spending money)
  if (body.dryRun) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        success: true,
        dryRun: true,
        endpoint: BOBGO_API,
        parcel: parcelForKg(body.weightKg),
        serviceLevelCode: body.serviceLevelCode || null,
        providerSlug: body.providerSlug || null,
      }),
    };
  }

  const started = Date.now();
  const result = await bookWithBobGo({
    delivery:         body.delivery,
    contact:          body.contact,
    weightKg:         body.weightKg,
    declaredValue:    body.declaredValue,
    serviceLevelCode: body.serviceLevelCode,
    providerSlug:     body.providerSlug,
    reference:        body.reference,
    instructions:     body.instructions,
  });

  // Always HTTP 200 so Cloudflare doesn't swap the body for its own error page;
  // callers read result.success.
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ...result, ms: Date.now() - started }),
  };
};
