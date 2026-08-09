/**
 * createManualOrder.js
 * Admin-only endpoint — creates an order placed on behalf of a customer.
 * Uses Supabase REST API (same project as the public site / payfast-notify.js).
 *
 * Required env vars:
 *   ADMIN_ORDER_KEY     – secret gate code
 *   SUPABASE_URL        – https://xpxbldyrigqjkdmrfhvh.supabase.co
 *   SUPABASE_SERVICE_KEY – service-role key (NOT the anon key)
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

// Map product name keywords → drop_code for stock tracking
const PRODUCT_STOCK_MAP = [
  { keywords: ['kiandu', 'kenya'], dropCode: 'KE-004' },
];

function makeRef() {
  const d    = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `EFT-${date}-${rand}`;
}

/** Parse item_description → [{dropCode, sizeGrams, qty}] for stock decrement */
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

  // Lightweight gate check — admin-order.html calls this with {adminKey, ping:true}
  // right when the code is entered, so a wrong code fails fast instead of only
  // surfacing once an admin has built out a whole order and hits Pay/Send.
  if (body.ping) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
  }

  if (!customer?.email || !customer?.name || !items?.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY env vars missing');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server config error' }) };
  }

  // ── Totals ───────────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipAmt  = shipping?.amount ?? 0;
  const total    = Math.max(0, subtotal + shipAmt - discountAmt);
  const itemDesc = items.map(i => `${i.qty}x ${i.name} (${i.size})`).join(', ');
  const ref      = makeRef();

  const authHeaders = {
    'Content-Type': 'application/json',
    apikey:         serviceKey,
    Authorization:  `Bearer ${serviceKey}`,
    Prefer:         'return=minimal',
  };

  // ── Insert order ──────────────────────────────────────────────────────────────
  try {
    const orderRes = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method:  'POST',
      headers: { ...authHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
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

    if (!orderRes.ok) {
      const errText = await orderRes.text();
      console.error('Supabase order insert error:', errText);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to save order' }) };
    }

    // Record discount use
    if (discountCode) {
      await fetch(`${supabaseUrl}/rest/v1/discount_uses`, {
        method:  'POST',
        headers: { ...authHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ code: discountCode, payment_id: ref, email: customer.email }),
      }).catch(e => console.warn('discount_uses insert failed:', e.message));
    }

    // Decrement roasted stock
    await decrementStock(supabaseUrl, serviceKey, itemDesc);

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
    console.error('Order creation error:', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to save order' }) };
  }
};
