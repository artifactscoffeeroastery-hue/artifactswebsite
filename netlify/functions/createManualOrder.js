/**
 * createManualOrder.js
 * Admin-only endpoint — creates an order placed on behalf of a customer.
 *
 * POST body (JSON):
 *   adminKey      – must match ADMIN_ORDER_KEY env var
 *   customer      – { name, email, phone }
 *   items         – [{ name, size, price, qty }]
 *   shipping      – { method, amount, address? }
 *   discountCode  – string | null
 *   discountAmt   – number (rand) | 0
 *   notes         – string | null
 *   paymentMethod – 'eft' | 'payfast'
 *
 * Returns (EFT):   { success, ref, total, banking }
 * Returns (PayFast): { success, ref } — PayFast form submitted client-side
 *
 * Required env vars:
 *   ADMIN_ORDER_KEY      – secret code checked on every request
 *   SUPABASE_URL         – project REST URL
 *   SUPABASE_SERVICE_KEY – service-role key
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const BANKING = {
  bank:          'First National Bank (FNB)',
  accountName:   'Artifacts Coffee Roastary',
  accountNumber: '62929285692',
  branchCode:    '250655',
  accountType:   'Business Current Account',
};

function makeRef() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `EFT-${date}-${rand}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { adminKey, customer, items, shipping, discountCode, discountAmt = 0, notes, paymentMethod = 'eft' } = body;

  // ── Auth check ──────────────────────────────────────────────────────────────
  const expectedKey = process.env.ADMIN_ORDER_KEY;
  if (!expectedKey || adminKey !== expectedKey) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── Validate required fields ─────────────────────────────────────────────────
  if (!customer?.email || !customer?.name || !items?.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // ── Totals ───────────────────────────────────────────────────────────────────
  const subtotal   = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipAmt    = shipping?.amount ?? 0;
  const total      = Math.max(0, subtotal + shipAmt - discountAmt);
  const itemDesc   = items.map(i => `${i.qty}x ${i.name} (${i.size})`).join(', ');
  const ref        = makeRef();

  // ── Insert into Supabase ─────────────────────────────────────────────────────
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Supabase env vars missing — URL:', !!supabaseUrl, 'KEY:', !!serviceKey);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server config error: missing env vars' }) };
  }

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:         serviceKey,
      Authorization:  `Bearer ${serviceKey}`,
      Prefer:         'return=representation',
    },
    body: JSON.stringify({
      payment_id:       ref,
      payment_method:   paymentMethod,
      status:           paymentMethod === 'eft' ? 'awaiting_payment' : 'pending',
      customer_name:    customer.name,
      email:            customer.email,
      phone:            customer.phone || null,
      amount_rand:      total,
      item_description: itemDesc,
      discount_code:    discountCode || null,
      shipping_method:  shipping?.method || null,
      shipping_amount:  shipAmt,
      shipping_address: shipping?.address || null,
      admin_notes:      notes || null,
      placed_by:        'admin',
    }),
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    console.error('Supabase insert error:', insertRes.status, err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: `Supabase ${insertRes.status}: ${err}` }) };
  }

  // ── Record discount use ──────────────────────────────────────────────────────
  if (discountCode) {
    await fetch(`${supabaseUrl}/rest/v1/discount_uses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         serviceKey,
        Authorization:  `Bearer ${serviceKey}`,
        Prefer:         'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({ code: discountCode, payment_id: ref, email: customer.email }),
    }).catch(e => console.warn('discount_uses insert failed:', e.message));
  }

  console.log(`Manual order created: ${ref} — R${total.toFixed(2)} for ${customer.email} via ${paymentMethod}`);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      success: true,
      ref,
      total,
      itemDesc,
      customer,
      banking: paymentMethod === 'eft' ? { ...BANKING, reference: ref } : null,
    }),
  };
};
