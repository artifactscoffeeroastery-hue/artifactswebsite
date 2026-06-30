/**
 * createManualOrder.js
 * Admin-only endpoint — creates an order placed on behalf of a customer.
 * Uses direct PostgreSQL connection (pg) to bypass PostgREST schema cache.
 *
 * Required env vars:
 *   ADMIN_ORDER_KEY – secret gate code
 *   DATABASE_URL    – Supabase transaction pooler URL:
 *                     postgresql://postgres.<ref>:[password]@aws-0-<region>.pooler.supabase.com:6543/postgres
 */

const { Client } = require('pg');

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

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const expectedKey = process.env.ADMIN_ORDER_KEY;
  if (!expectedKey || adminKey !== expectedKey) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!customer?.email || !customer?.name || !items?.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // ── Totals ───────────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipAmt  = shipping?.amount ?? 0;
  const total    = Math.max(0, subtotal + shipAmt - discountAmt);
  const itemDesc = items.map(i => `${i.qty}x ${i.name} (${i.size})`).join(', ');
  const ref      = makeRef();

  // ── Direct PostgreSQL insert ──────────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL env var missing');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server config error' }) };
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `INSERT INTO orders
         (payment_id, payment_method, status, customer_name, email, phone,
          amount_rand, item_description, discount_code,
          shipping_method, shipping_amount, shipping_address,
          admin_notes, placed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        ref,
        paymentMethod,
        paymentMethod === 'eft' ? 'awaiting_payment' : 'pending',
        customer.name,
        customer.email,
        customer.phone || null,
        total,
        itemDesc,
        discountCode || null,
        shipping?.method || null,
        shipAmt,
        shipping?.address || null,
        notes || null,
        'admin',
      ]
    );

    // Record discount use
    if (discountCode) {
      await client.query(
        `INSERT INTO discount_uses (code, payment_id, email) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [discountCode, ref, customer.email]
      ).catch(e => console.warn('discount_uses insert failed:', e.message));
    }

    console.log(`Manual order created: ${ref} — R${total.toFixed(2)} for ${customer.email}`);

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
  } catch (e) {
    console.error('DB insert error:', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to save order' }) };
  } finally {
    await client.end();
  }
};
