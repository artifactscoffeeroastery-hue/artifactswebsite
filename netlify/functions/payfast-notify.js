/**
 * payfast-notify.js
 * PayFast ITN (Instant Transaction Notification) handler
 *
 * Flow:
 *  1. Parse URLencoded POST body
 *  2. Verify MD5 signature
 *  3. Validate with PayFast server (server-to-server)
 *  4. On COMPLETE payment → award Brew Circle points via Supabase
 *  5. Collect-from-us orders → email the roaster via Resend
 *
 * Required env vars (set in Netlify dashboard → Environment variables):
 *   PAYFAST_PASSPHRASE      – your PayFast account passphrase (leave blank if not set)
 *   SUPABASE_URL            – https://xpxbldyrigqjkdmrfhvh.supabase.co
 *   SUPABASE_SERVICE_KEY    – service-role key (NOT the anon key)
 *   RESEND_API_KEY          – for collection-order notification emails
 */

const crypto = require('crypto');
const https  = require('https');
const qs     = require('querystring');

// ── Constants ────────────────────────────────────────────────────────────────
const PAYFAST_MERCHANT_ID  = '34420469';
const PAYFAST_VALIDATE_URL = 'https://www.payfast.co.za/eng/query/validate';
const POINTS_PER_RAND      = 1; // 1 point per R1 spent

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build PayFast signature string and return its MD5 hash */
function buildSignature(params, passphrase) {
  // Sort params alphabetically, exclude 'signature'
  const sorted = Object.keys(params)
    .filter(k => k !== 'signature' && params[k] !== '')
    .sort()
    .map(k => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`)
    .join('&');

  const str = passphrase ? `${sorted}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}` : sorted;
  return crypto.createHash('md5').update(str).digest('hex');
}

/** POST raw body to PayFast validation endpoint, returns 'VALID' or 'INVALID' */
function validateWithPayFast(rawBody) {
  return new Promise((resolve, reject) => {
    const url     = new URL(PAYFAST_VALIDATE_URL);
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(rawBody),
      },
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve(body.trim()));
    });

    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

/** Award purchase points and record the order in Supabase */
async function recordOrderAndAwardPoints({ email, amountRand, paymentId, itemDesc, discountCode, shippingMethod }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn('Supabase env vars not set — skipping points award');
    return;
  }

  const points = Math.floor(amountRand * POINTS_PER_RAND);

  // 1. Find customer by email
  const userRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const userData = await userRes.json();
  const user     = userData?.users?.[0];

  if (!user) {
    console.warn(`No Brew Circle member found for ${email} — skipping points`);
    return;
  }

  const customerId = user.id;
  const authHeaders = {
    'Content-Type':  'application/json',
    apikey:          serviceKey,
    Authorization:   `Bearer ${serviceKey}`,
    Prefer:          'return=minimal',
  };

  // 2. Upsert order record
  await fetch(`${supabaseUrl}/rest/v1/orders`, {
    method:  'POST',
    headers: { ...authHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      payment_id:      paymentId,
      customer_id:     customerId,
      email,
      amount_rand:     amountRand,
      item_description: itemDesc,
      discount_code:   discountCode || null,
      shipping_method: shippingMethod || null,
      status:          'complete',
    }),
  });

  // 3. Record discount code use (powers live founder counter)
  if (discountCode) {
    await fetch(`${supabaseUrl}/rest/v1/discount_uses`, {
      method:  'POST',
      headers: { ...authHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ code: discountCode, payment_id: paymentId, email }),
    });
  }

  // 4. Credit point_events
  await fetch(`${supabaseUrl}/rest/v1/point_events`, {
    method:  'POST',
    headers: authHeaders,
    body: JSON.stringify({
      customer_id:  customerId,
      event_type:   'purchase',
      points:       points,
      description:  `Order ${paymentId} — R${amountRand.toFixed(2)}`,
      reference_id: paymentId,
    }),
  });

  // 5. Update customer points balance (incremental)
  await fetch(
    `${supabaseUrl}/rest/v1/rpc/increment_customer_points`,
    {
      method:  'POST',
      headers: authHeaders,
      body: JSON.stringify({ p_customer_id: customerId, p_points: points }),
    }
  );

  console.log(`Awarded ${points} pts to ${email} for order ${paymentId}`);
}

/** Email the roaster when a customer pays online to collect in person */
async function notifyCollection({ email, phone, itemDesc, amountRand, paymentId, shipMethod }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set — skipping collection email'); return; }
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from:    'Artifacts Coffee <onboarding@resend.dev>',
      to:      ['artifacts.coffee.roastery@gmail.com'],
      subject: `Collection order (paid) — ${email}`,
      html: `
        <h2>New collection order — paid online</h2>
        <p><strong>Order:</strong> ${paymentId}</p>
        <p><strong>Items:</strong> ${itemDesc || '—'}</p>
        <p><strong>Total paid:</strong> R${amountRand.toFixed(2)}</p>
        <p><strong>Method:</strong> ${shipMethod}</p>
        <p><strong>Customer email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || 'not provided'}</p>
        <p>Contact the customer to arrange a pickup time.</p>`
    })
  });
  console.log(`Collection email sent for order ${paymentId}`);
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // PayFast only POSTs to this endpoint
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const rawBody = event.body || '';
    const params  = qs.parse(rawBody);

    // ── 1. Basic sanity checks ──────────────────────────────────────────────
    if (params.merchant_id !== PAYFAST_MERCHANT_ID) {
      console.error('Merchant ID mismatch', params.merchant_id);
      return { statusCode: 400, body: 'Invalid merchant' };
    }

    // ── 2. Signature verification ───────────────────────────────────────────
    const passphrase  = process.env.PAYFAST_PASSPHRASE || '';
    const expectedSig = buildSignature(params, passphrase);
    const receivedSig = (params.signature || '').toLowerCase();

    if (expectedSig !== receivedSig) {
      console.error('Signature mismatch', { expected: expectedSig, received: receivedSig });
      return { statusCode: 400, body: 'Signature mismatch' };
    }

    // ── 3. Server-side validation with PayFast ──────────────────────────────
    const validationResult = await validateWithPayFast(rawBody);
    if (validationResult !== 'VALID') {
      console.error('PayFast validation failed:', validationResult);
      return { statusCode: 400, body: 'PayFast validation failed' };
    }

    // ── 4. Process completed payments ───────────────────────────────────────
    if (params.payment_status === 'COMPLETE') {
      const amountRand = parseFloat(params.amount_gross || '0');
      const paymentId  = params.m_payment_id || params.pf_payment_id || `PF-${Date.now()}`;
      const shipMethod = params.custom_str2 || '';

      await recordOrderAndAwardPoints({
        email:          params.email_address || '',
        amountRand,
        paymentId,
        itemDesc:       params.item_description || '',
        discountCode:   params.custom_str1 || '',
        shippingMethod: shipMethod,
      });

      // Collect-from-us orders: alert the roaster by email so they can arrange pickup
      if (/collect from/i.test(shipMethod)) {
        await notifyCollection({
          email:     params.email_address || '',
          phone:     params.custom_str5 || '',
          itemDesc:  params.item_description || '',
          amountRand,
          paymentId,
          shipMethod,
        }).catch(e => console.error('Collection notify error:', e.message));
      }
    } else {
      console.log(`Payment status: ${params.payment_status} — no action taken`);
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('payfast-notify error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
