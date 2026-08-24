/**
 * payfast-notify.js
 * PayFast ITN (Instant Transaction Notification) handler
 *
 * Flow:
 *  1. Parse URLencoded POST body
 *  2. Verify MD5 signature
 *  3. Validate with PayFast server (server-to-server)
 *  4. On COMPLETE payment → record the order (member or guest) + award
 *     Brew Circle points if the buyer has an account
 *  5. Collect-from-us orders → email the roaster via Resend
 *
 * Session 19: `orders` here (project xpxbldyrigqjkdmrfhvh) is now the one
 * authoritative order record for every live paid order, not just Brew
 * Circle members — run brew-circle-orders-unify.sql once against that
 * project before deploying this file. The separate admin-order Supabase
 * project (hwfwnzsjcblleykegiay, used by createManualOrder.js) still has
 * its own orders table for admin-created quotes/invoices — reconciling
 * that one too is a follow-up, not done in this pass.
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

// Map product name keywords → drop_code for stock tracking
const PRODUCT_STOCK_MAP = [
  { keywords: ['kiandu', 'kenya'], dropCode: 'KE-004' },
];

/** Parse item_description → [{dropCode, sizeGrams, qty}] */
function parseStockItems(itemDesc) {
  if (!itemDesc) return [];
  return itemDesc.split(',').flatMap(part => {
    const qty  = parseInt((part.match(/(\d+)x/i) || [])[1] || '0');
    const size = parseInt((part.match(/(\d+)\s*g/i) || [])[1] || '0');
    if (!qty || !size) return [];
    const lower = part.toLowerCase();
    const match = PRODUCT_STOCK_MAP.find(p => p.keywords.some(k => lower.includes(k)));
    return match ? [{ dropCode: match.dropCode, sizeGrams: size, qty }] : [];
  });
}

// Map product name keywords → slug/name/price-by-size, for populating order_items.
// Mirrors admin-order.html's PRODUCTS array — keep the two in sync (see
// CLAUDE.md "Live Drop Checklist"). item_description comes from
// `${qty}x ${name} (${size})` built client-side in js/main.js's checkout flow.
// Note: "20" is the Drip Bags 10-pack (label deliberately contains "20g" — one bag's fill
// weight — so it matches this same size-extraction regex; the *price* at key 20 is the
// per-pack price, same convention as 80/200/400 being per-bag prices, since order_items
// quantity tracks number of packs/bags, not grams).
const PRODUCT_PRICE_MAP = [
  { keywords: ['kiandu', 'kenya'],        slug: 'kenya',     name: 'Kenya Kiandu AB',     prices: { 80: 110, 200: 195, 400: 355, 20: 225 } },
  { keywords: ['las nubes', 'nicaragua'], slug: 'nicaragua', name: 'Nicaragua Las Nubes', prices: { 80: 125, 200: 220, 400: 375, 20: 240 } },
];

/** Parse item_description → [{product_slug, product_name, quantity, unit_price_rand, grind}]
 *  item_description is built client-side (js/main.js) as `${qty}x ${name} (${size}, ${grind})`,
 *  items themselves joined with ", ". Since each item's own "(size, grind)" contains a comma,
 *  a naive top-level split(',') breaks one item into two fragments — the first starting with
 *  "<qty>x", the second (the grind) not. Walk the fragments and re-join a non-"<qty>x" fragment
 *  onto the item before it. Also tolerates the old grind-less format ("(size)", no internal
 *  comma, one fragment per item) for any pre-existing/older order_description values. */
function parseOrderItems(itemDesc) {
  if (!itemDesc) return [];
  const parts = itemDesc.split(',').map(p => p.trim());
  const results = [];
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d+x/i.test(parts[i])) continue; // stray fragment, already consumed below
    let combined = parts[i];
    if (i + 1 < parts.length && !/^\d+x/i.test(parts[i + 1])) {
      combined += ', ' + parts[i + 1];
      i++; // consume it so the outer loop doesn't also treat it as its own fragment
    }

    const qty  = parseInt((combined.match(/^(\d+)x/i) || [])[1] || '0');
    const size = parseInt((combined.match(/(\d+)\s*g/i) || [])[1] || '0');
    if (!qty) continue;

    const grindMatch = combined.match(/,\s*([^,()]+)\)\s*$/);
    const grind = grindMatch ? grindMatch[1].trim() : 'Whole Bean';

    const lower = combined.toLowerCase();
    const match = PRODUCT_PRICE_MAP.find(p => p.keywords.some(k => lower.includes(k)));
    if (!match) {
      console.warn(`order_items: no product match for "${combined}" — skipping line item`);
      continue;
    }

    const unitPrice = match.prices[size];
    if (unitPrice === undefined) {
      console.warn(`order_items: no known price for ${match.slug} at ${size || '?'}g — skipping line item`);
      continue;
    }

    const productName = size === 20
      ? `${match.name} — Drip Bags 10-Pack`
      : (size ? `${match.name} — ${size}g` : match.name);
    results.push({
      product_slug:    match.slug,
      product_name:    productName,
      quantity:        qty,
      unit_price_rand: unitPrice,
      grind,
    });
  }
  return results;
}

/** Decrement roasted_stock via Supabase RPC */
async function decrementStock(supabaseUrl, serviceKey, itemDesc) {
  const items = parseStockItems(itemDesc);
  for (const { dropCode, sizeGrams, qty } of items) {
    await fetch(`${supabaseUrl}/rest/v1/rpc/decrement_stock`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         serviceKey,
        Authorization:  `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_drop_code: dropCode, p_size_grams: sizeGrams, p_qty: qty }),
    }).catch(e => console.warn('decrement_stock failed:', e.message));
  }
}

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

/** Record the order in Supabase (every paid order, member or guest) and award Brew Circle points if applicable */
async function recordOrderAndAwardPoints({ email, amountRand, paymentId, pfPaymentId, itemDesc, discountCode, shippingMethod, customerName, phone, shippingAmount, shippingAddress }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn('Supabase env vars not set — skipping order recording');
    return;
  }

  const points = Math.floor(amountRand * POINTS_PER_RAND);

  // 1. Find a matching Brew Circle member by email, if any. Session 19:
  // guests (no matching account) used to make this whole function bail
  // out via an early return, so guest checkouts never got an order row
  // ANYWHERE in Supabase — no name, email, or shipping address persisted
  // once the PayFast confirmation email was sent. Now we only skip the
  // points-award steps (4-5) for guests; the order itself is always recorded.
  let customerId = null;
  if (email) {
    const userRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const userData = await userRes.json();
    customerId = userData?.users?.[0]?.id || null;
  }
  if (!customerId) {
    console.log(`No Brew Circle member found for ${email || '(no email)'} — order will still be recorded, points skipped`);
  }

  const authHeaders = {
    'Content-Type':  'application/json',
    apikey:          serviceKey,
    Authorization:   `Bearer ${serviceKey}`,
    Prefer:          'return=minimal',
  };

  // 2. Insert the order record. Session 19 migration (see
  // brew-circle-orders-unify.sql) made customer_id nullable and added
  // customer_name/email/phone/shipping_method/shipping_amount/
  // shipping_address/placed_by, so this table can finally be the one
  // authoritative order record for every paid order on the live site —
  // not just Brew Circle members. We generate the id ourselves (instead
  // of letting the DB default it) so it can be used below for order_items
  // without a second round-trip.
  const orderId = crypto.randomUUID();
  const orderRes = await fetch(`${supabaseUrl}/rest/v1/orders`, {
    method:  'POST',
    headers: { ...authHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      id:                    orderId,
      customer_id:           customerId,
      customer_name:         customerName || null,
      email:                 email || null,
      phone:                 phone || null,
      total_rand:            Math.round(amountRand),
      payfast_payment_id:    paymentId,
      payfast_pf_payment_id: pfPaymentId || null,
      status:                'complete',
      promo_code:            discountCode || null,
      shipping_method:       shippingMethod || null,
      shipping_amount:       shippingAmount ? Math.round(parseFloat(shippingAmount)) : null,
      shipping_address:      shippingAddress || null,
      placed_by:             'customer',
    }),
  });
  if (!orderRes.ok) {
    console.error('orders insert failed:', orderRes.status, await orderRes.text());
  } else {
    // 2b. Line items — best-effort. Parses item_description (built
    // client-side in js/main.js as `${qty}x ${name} (${size})`) against
    // PRODUCT_PRICE_MAP. Unmatched lines are skipped with a warning
    // rather than blocking the rest of order/points processing.
    const items = parseOrderItems(itemDesc);
    for (const item of items) {
      const itemRes = await fetch(`${supabaseUrl}/rest/v1/order_items`, {
        method:  'POST',
        headers: authHeaders,
        body: JSON.stringify({
          order_id:        orderId,
          product_slug:    item.product_slug,
          product_name:    item.product_name,
          quantity:        item.quantity,
          unit_price_rand: item.unit_price_rand,
          grind:           item.grind,
        }),
      });
      if (!itemRes.ok) console.error('order_items insert failed:', itemRes.status, await itemRes.text());
    }
  }

  // 3. Record discount code use (powers live founder counter) — for
  // every order now, member or guest (previously this was unreachable
  // for guests too, since it sat after the early-return).
  if (discountCode) {
    const discRes = await fetch(`${supabaseUrl}/rest/v1/discount_uses`, {
      method:  'POST',
      headers: { ...authHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ code: discountCode, payment_id: paymentId, email }),
    });
    if (!discRes.ok) console.error('discount_uses insert failed:', discRes.status, await discRes.text());
  }

  // 4-5. Points only apply to Brew Circle members — guests stop here,
  // their order is already safely recorded above.
  if (!customerId) return;

  // NOTE: point_events has no `reference_id` column (confirmed via
  // information_schema — real columns are id, customer_id, event_type,
  // points, description, order_id, created_by, created_at).
  const peRes = await fetch(`${supabaseUrl}/rest/v1/point_events`, {
    method:  'POST',
    headers: authHeaders,
    body: JSON.stringify({
      customer_id: customerId,
      event_type:  'purchase',
      points:      points,
      description: `Order ${paymentId} — R${amountRand.toFixed(2)}`,
      order_id:    orderId,
    }),
  });
  if (!peRes.ok) console.error('point_events insert failed:', peRes.status, await peRes.text());

  // 5. Update customer points balance (incremental) — requires the
  // increment_customer_points RPC created in Session 18.
  const incRes = await fetch(
    `${supabaseUrl}/rest/v1/rpc/increment_customer_points`,
    {
      method:  'POST',
      headers: authHeaders,
      body: JSON.stringify({ p_customer_id: customerId, p_points: points }),
    }
  );
  if (!incRes.ok) console.error('increment_customer_points failed:', incRes.status, await incRes.text());

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
      const amountRand  = parseFloat(params.amount_gross || '0');
      const paymentId   = params.m_payment_id || params.pf_payment_id || `PF-${Date.now()}`;
      const pfPaymentId = params.pf_payment_id || null;
      const shipMethod  = params.custom_str2 || '';

      await recordOrderAndAwardPoints({
        email:           params.email_address || '',
        amountRand,
        paymentId,
        pfPaymentId,
        itemDesc:        params.item_description || '',
        discountCode:    params.custom_str1 || '',
        shippingMethod:  shipMethod,
        // Session 19: previously unread — index.html's hidden PayFast form
        // already sends these (name_first, custom_str3, custom_str4), they
        // just weren't being picked up on the way in.
        customerName:    params.name_first || '',
        phone:           params.custom_str5 || '',
        shippingAmount:  params.custom_str3 || '',
        shippingAddress: params.custom_str4 || '',
      });

      // Decrement roasted stock
      await decrementStock(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
        params.item_description || ''
      ).catch(e => console.error('Stock decrement error:', e.message));

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
