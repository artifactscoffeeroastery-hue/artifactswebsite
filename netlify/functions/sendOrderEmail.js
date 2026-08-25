/**
 * sendOrderEmail.js
 * Sends a quote or invoice email to a customer on Denzel's behalf, from
 * admin-order.html's "Email Quote" / "Email Invoice" buttons. Replaces the
 * old mailto: handoff (which relied on a local mail client and gave no
 * confirmation) with a real server-side send via Resend, so the admin UI
 * can show a genuine success/failure toast.
 *
 * Required env vars:
 *   ADMIN_ORDER_KEY   – same secret gate code as createManualOrder.js
 *   RESEND_API_KEY    – Resend transactional email
 *   MAIL_FROM         – e.g. "Artifacts Coffee <hello@artifactscoffee.co.za>"
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAIL_FROM = process.env.MAIL_FROM || 'Artifacts Coffee <onboarding@resend.dev>';
const BANK = {
  bank: 'First National Bank (FNB)',
  accountName: 'Artifacts Coffee Roastary',
  accountNumber: '62929285692',
  branchCode: '250655',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildHtml({ type, customer, items, sub, ship, disc, total, ref, fulfilLabel, date }) {
  const isInvoice = type === 'invoice';
  const docLabel  = isInvoice ? 'Invoice' : 'Quote';
  const accent    = isInvoice ? '#E1FF01' : '#0FA8DF';

  const rows = (items || []).map(it => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px 0;">${esc(it.name)}<br><small style="color:#888;">${esc(it.size)}${it.grind ? ' &middot; ' + esc(it.grind) : ''}</small></td>
      <td style="text-align:center;padding:10px 0;">${esc(it.qty)}</td>
      <td style="text-align:right;padding:10px 0;">R ${(Number(it.price) * Number(it.qty)).toFixed(2)}</td>
    </tr>`).join('');

  const bankSection = isInvoice ? `
    <div style="margin-top:20px;padding:16px;background:#f9f9f9;border-left:3px solid ${accent};">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;color:#333;">Banking Details</p>
      <p style="font-size:13px;line-height:1.8;margin:0;color:#333;">
        ${esc(BANK.bank)}<br>
        Account Name: ${esc(BANK.accountName)}<br>
        Account Number: ${esc(BANK.accountNumber)}<br>
        Branch Code: ${esc(BANK.branchCode)}<br>
        Reference: <strong>${esc(ref)}</strong>
      </p>
    </div>` : '';

  return `
  <div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="background:#0a0a0a;padding:24px;text-align:center;">
      <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:2px;">ARTIFACTS COFFEE</div>
      <div style="color:${accent};font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">${docLabel}${isInvoice ? '' : ' &mdash; awaiting acceptance'}</div>
    </div>
    <div style="padding:24px;border:1px solid #eee;border-top:none;">
      <p style="margin:0 0 4px;font-size:15px;">Hi ${esc((customer.name || '').split(' ')[0] || 'there')},</p>
      <p style="margin:0 0 16px;color:#666;font-size:13px;">Please find your ${docLabel.toLowerCase()} from Artifacts Coffee below.</p>
      <table style="width:100%;font-size:13px;color:#333;margin-bottom:16px;border-collapse:collapse;">
        <tr><td style="padding:3px 0;color:#888;">Reference</td><td style="text-align:right;font-weight:700;">${esc(ref)}</td></tr>
        <tr><td style="padding:3px 0;color:#888;">Date</td><td style="text-align:right;">${esc(date)}</td></tr>
        <tr><td style="padding:3px 0;color:#888;">Fulfilment</td><td style="text-align:right;">${esc(fulfilLabel || '—')}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:2px solid #111;"><th style="text-align:left;padding:8px 0;">Item</th><th style="text-align:center;padding:8px 0;">Qty</th><th style="text-align:right;padding:8px 0;">Amount</th></tr>
        ${rows}
        <tr><td colspan="2" style="padding:10px 0;color:#888;">Subtotal</td><td style="text-align:right;padding:10px 0;">R ${Number(sub || 0).toFixed(2)}</td></tr>
        ${ship > 0 ? `<tr><td colspan="2" style="padding:4px 0;color:#888;">Shipping</td><td style="text-align:right;padding:4px 0;">R ${Number(ship).toFixed(2)}</td></tr>` : ''}
        ${disc > 0 ? `<tr><td colspan="2" style="padding:4px 0;color:#888;">Discount</td><td style="text-align:right;padding:4px 0;">&minus; R ${Number(disc).toFixed(2)}</td></tr>` : ''}
        <tr><td colspan="2" style="padding:12px 0;font-weight:700;font-size:15px;">Total</td><td style="text-align:right;padding:12px 0;font-weight:700;font-size:15px;color:#1a7f37;">R ${Number(total || 0).toFixed(2)}</td></tr>
      </table>
      ${bankSection}
      <p style="margin-top:24px;font-size:13px;color:#333;">With care,<br>Denzel &middot; Artifacts Coffee<br><a href="mailto:hello@artifactscoffee.co.za" style="color:#0FA8DF;">hello@artifactscoffee.co.za</a></p>
    </div>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) }; }

  const expectedKey = process.env.ADMIN_ORDER_KEY;
  if (!expectedKey || body.adminKey !== expectedKey) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { type, customer, items } = body;
  if (!customer?.email || !customer?.name || !items?.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'RESEND_API_KEY not configured on the server' }) };
  }

  const docLabel = type === 'invoice' ? 'Invoice' : 'Quote';
  const html = buildHtml(body);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [customer.email],
        subject: `Artifacts Coffee ${docLabel} — ${body.ref || ''}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error sending order email:', res.status, errText);
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Resend rejected the email', detail: errText }) };
    }

    const data = await res.json();
    console.log(`${docLabel} emailed to ${customer.email} (ref ${body.ref || 'n/a'}), Resend id ${data.id || 'n/a'}`);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, id: data.id || null }) };
  } catch (e) {
    console.error('sendOrderEmail fetch error:', e.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Could not reach Resend', detail: e.message }) };
  }
};
