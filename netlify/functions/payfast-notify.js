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

// ── Business / customer-invoice details ──────────────────────────────────────
// MAIL_FROM: once your domain is verified in Resend, set env MAIL_FROM to
// "Artifacts Coffee <hello@artifactscoffee.co.za>". Until then the shared
// resend.dev sender only delivers to your own account email.
const MAIL_FROM = process.env.MAIL_FROM || 'Artifacts Coffee <onboarding@resend.dev>';
const BIZ = {
  name:  'Artifacts Coffee Roastary',
  email: 'hello@artifactscoffee.co.za',
  site:  'https://artifactscoffee.co.za',
  vat:   '', // ← if VAT-registered, add your VAT number to make this a valid tax invoice
};

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

/** Email the customer a paid receipt / tax invoice */
async function sendCustomerInvoice({ email, itemDesc, amountRand, paymentId, shipMethod, discountCode }) {
  const key = process.env.RESEND_API_KEY;
  if (!key)   { console.warn('RESEND_API_KEY not set — skipping customer invoice'); return; }
  if (!email) { console.warn('No customer email — skipping invoice'); return; }

  const date    = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
  const docType = BIZ.vat ? 'Tax Invoice' : 'Receipt';
  const vatRow  = BIZ.vat ? `<p style="margin:2px 0;color:#888;font-size:12px;">VAT No: ${BIZ.vat}</p>` : '';

  const html = `
  <div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="background:#0a0a0a;padding:24px;text-align:center;">
      <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:2px;">ARTIFACTS COFFEE</div>
      <div style="color:#C8373E;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">${docType}</div>
    </div>
    <div style="padding:24px;border:1px solid #eee;border-top:none;">
      <p style="margin:0 0 4px;font-size:15px;">Thank you for your order.</p>
      <p style="margin:0 0 16px;color:#666;font-size:13px;">Payment received &mdash; this is your ${docType.toLowerCase()}.</p>
      <table style="width:100%;font-size:13px;color:#333;margin-bottom:16px;border-collapse:collapse;">
        <tr><td style="padding:3px 0;color:#888;">Order reference</td><td style="text-align:right;font-weight:700;">${paymentId}</td></tr>
        <tr><td style="padding:3px 0;color:#888;">Date</td><td style="text-align:right;">${date}</td></tr>
        <tr><td style="padding:3px 0;color:#888;">Fulfilment</td><td style="text-align:right;">${shipMethod || '—'}</td></tr>
        ${discountCode ? `<tr><td style="padding:3px 0;color:#888;">Code</td><td style="text-align:right;">${discountCode}</td></tr>` : ''}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:2px solid #111;"><th style="text-align:left;padding:8px 0;">Item</th><th style="text-align:right;padding:8px 0;">Amount</th></tr>
        <tr style="border-bottom:1px solid #eee;"><td style="padding:10px 0;">${itemDesc || 'Artifacts Coffee order'}</td><td style="text-align:right;padding:10px 0;">R${amountRand.toFixed(2)}</td></tr>
        <tr><td style="padding:12px 0;font-weight:700;font-size:15px;">Total paid</td><td style="text-align:right;padding:12px 0;font-weight:700;font-size:15px;color:#1a7f37;">R${amountRand.toFixed(2)}</td></tr>
      </table>
      <div style="margin-top:8px;display:inline-block;background:#e7f6ec;color:#1a7f37;font-size:12px;font-weight:700;padding:4px 10px;border-radius:3px;">PAID</div>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
      <p style="margin:0;color:#888;font-size:12px;">${BIZ.name}</p>
      ${vatRow}
      <p style="margin:2px 0;color:#888;font-size:12px;"><a href="${BIZ.site}" style="color:#C8373E;text-decoration:none;">${BIZ.site.replace('https://', '')}</a> &middot; ${BIZ.email}</p>
    </div>
  </div>`;

  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from:    MAIL_FROM,
      to:      [email],
      subject: `Your Artifacts Coffee ${docType.toLowerCase()} — ${paymentId}`,
      html,
    })
  });
  console.log(`Customer ${docType} sent to ${email} for order ${paymentId}`);
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

      // Email the customer their paid receipt / tax invoice
      await sendCustomerInvoice({
        email:        params.email_address || '',
        itemDesc:     params.item_description || '',
        amountRand,
        paymentId,
        shipMethod,
        discountCode: params.custom_str1 || '',
      }).catch(e => console.error('Customer invoice error:', e.message));

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
