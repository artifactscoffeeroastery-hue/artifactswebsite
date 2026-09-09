/**
 * sheetLog.js
 * Admin-only proxy in front of the Google Apps Script "Orders" sheet logger
 * (google-sheet-logger.gs). Holds SHEET_LOG_URL + SHEET_LOG_TOKEN server-side
 * so neither ever ships to the browser — previously both were hardcoded as
 * plain `var`s in admin-order.html, publicly readable in page source
 * regardless of the admin gate (the gate only hides the UI, not the source).
 *
 * Replaces the old direct-from-browser calls:
 *   - logToSheet()  in admin-order.html  → POST here with action:'log'
 *   - loadClients() in admin-order.html  → POST here with action:'clients'
 *     (was a JSONP <script src> hit directly on the Apps Script URL; now a
 *     same-origin fetch, so JSONP is no longer needed for CORS purposes)
 *
 * Required env vars:
 *   ADMIN_ORDER_KEY  – same secret gate code used by createManualOrder.js /
 *                      sendOrderEmail.js / bookShipment.js
 *   SHEET_LOG_URL    – the Apps Script /exec Web App URL
 *   SHEET_LOG_TOKEN  – shared secret, must match SHEET_LOG_TOKEN in the
 *                      Apps Script project (google-sheet-logger.gs)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const ADMIN_KEY = process.env.ADMIN_ORDER_KEY;
  if (!ADMIN_KEY || body.adminKey !== ADMIN_KEY) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const SHEET_LOG_URL   = process.env.SHEET_LOG_URL;
  const SHEET_LOG_TOKEN = process.env.SHEET_LOG_TOKEN;
  if (!SHEET_LOG_URL || !SHEET_LOG_TOKEN) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Sheet logging not configured (SHEET_LOG_URL/SHEET_LOG_TOKEN missing)' }) };
  }

  try {
    if (body.action === 'clients') {
      return await handleClients(SHEET_LOG_URL, SHEET_LOG_TOKEN);
    }
    if (body.action === 'log') {
      return await handleLog(SHEET_LOG_URL, SHEET_LOG_TOKEN, body);
    }
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (e) {
    console.error('sheetLog error:', e);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Upstream sheet request failed' }) };
  }
};

/** doGet always wraps its response as `<callback>({...})` (JSONP), defaulting
 * the callback name to "callback" when none is supplied. Strip that wrapper
 * server-side so the browser gets plain JSON back. */
async function handleClients(url, token) {
  const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  const text = await res.text();
  const match = text.match(/^[^(]*\((.*)\)\s*;?\s*$/s);
  if (!match) {
    console.error('sheetLog: unexpected doGet response shape:', text.slice(0, 200));
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ clients: [] }) };
  }
  let json;
  try { json = JSON.parse(match[1]); } catch (e) { json = { clients: [] }; }
  return { statusCode: 200, headers: CORS, body: JSON.stringify(json) };
}

async function handleLog(url, token, body) {
  const payload = {
    token,
    customerId:  body.customerId  || '',
    orderNo:     body.orderNo     || '',
    type:        body.kind        || '',
    ref:         body.ref         || '',
    timestamp:   body.timestamp   || new Date().toISOString(),
    name:        body.name        || '',
    email:       body.email       || '',
    phone:       body.phone       || '',
    items:       body.items       || '',
    subtotal:    body.subtotal    || 0,
    shipping:    body.shipping    || 0,
    discount:    body.discount    || 0,
    total:       body.total       || 0,
    fulfilment:  body.fulfilment  || '',
    address:     body.address     || '',
    notes:       body.notes       || '',
    addressData: body.addressData || '',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const ok = text.trim() === 'ok';
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok, upstream: text.slice(0, 200) }) };
}
