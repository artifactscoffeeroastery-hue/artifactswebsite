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

// Mirrors the look of admin-order.html's buildDocHTML() print/open invoice —
// same layout and colour language, just inlined for email clients (no
// external font <link>, since most inboxes strip those anyway; fallback
// fonts are specified so it still reads cleanly without them).
function buildHtml({ type, customer, items, sub, ship, disc, total, ref, orderNo, fulfilLabel, fulfilAddress, notes, date }) {
  const isInvoice   = type === 'invoice';
  const accent      = isInvoice ? '#E1FF01' : '#0FA8DF';
  const statusLabel = isInvoice ? 'INVOICE' : 'QUOTE — AWAITING ACCEPTANCE';
  const bebas       = "'Bebas Neue',Arial,sans-serif";
  const barlow      = "'Barlow Condensed',Arial,sans-serif";
  const mono        = "'DM Mono',Consolas,monospace";

  const itemRows = (items || []).map(it => `
    <tr>
      <td style="padding:10px 0;font-family:${mono};font-size:13px;">${esc(it.name)}<br><small style="color:#666;">${esc(it.size)}${it.grind ? ' &middot; ' + esc(it.grind) : ''}</small></td>
      <td style="text-align:center;padding:10px 0;font-family:${mono};font-size:13px;">${esc(it.qty)}</td>
      <td style="text-align:right;padding:10px 0;font-family:${mono};font-size:13px;">R ${Number(it.price).toFixed(2)}</td>
      <td style="text-align:right;padding:10px 0;font-family:${mono};font-size:13px;">R ${(Number(it.price) * Number(it.qty)).toFixed(2)}</td>
    </tr>`).join('');

  const bankSection = isInvoice ? `
    <div style="margin-top:20px;padding:16px;background:#f9f9f9;border-left:3px solid ${accent};">
      <p style="font-family:${barlow};font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 10px;color:#111;">Banking Details</p>
      <p style="font-family:${mono};font-size:13px;line-height:1.8;margin:0;color:#111;">
        ${esc(BANK.bank)}<br>
        Account Name: ${esc(BANK.accountName)}<br>
        Account Number: ${esc(BANK.accountNumber)}<br>
        Branch Code: ${esc(BANK.branchCode)}<br>
        Reference: <strong>${esc(ref)}</strong>
      </p>
    </div>` : '';

  const notesSection = notes ? `
    <div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;font-family:${mono};font-size:12px;color:#111;">
      <strong>Notes:</strong> ${esc(notes)}
    </div>` : '';

  const th = `text-align:left;padding:8px 0;font-family:${barlow};font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#999;`;

  return `
  <div style="max-width:640px;margin:0 auto;font-family:${mono};font-size:13px;line-height:1.6;color:#111;background:#fff;padding:8px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:32px;"><tr>
      <td style="vertical-align:top;">
        <p style="font-family:${bebas};font-size:28px;letter-spacing:0.06em;margin:0;">ARTIFACTS COFFEE</p>
        <p style="font-size:11px;color:#666;margin:4px 0 0;">hello@artifactscoffee.co.za</p>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <span style="display:inline-block;background:${accent};color:#111;font-family:${barlow};font-size:11px;font-weight:700;letter-spacing:0.2em;padding:4px 12px;margin-bottom:8px;">${statusLabel}</span>
        <p style="font-family:${barlow};font-size:13px;font-weight:700;margin:0;">${esc(ref)}</p>
        <p style="font-size:11px;color:#666;margin:2px 0 0;">Order ${esc(orderNo || '')}</p>
        <p style="font-size:12px;color:#666;margin:2px 0 0;">${esc(date)}</p>
      </td>
    </tr></table>
    <div style="margin-bottom:24px;padding:14px;background:#f9f9f9;">
      <p style="font-family:${barlow};font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#999;margin:0 0 6px;">To</p>
      <p style="font-size:13px;margin:0;">${esc(customer.name)}</p>
      <p style="font-size:12px;color:#666;margin:2px 0 0;">${esc(customer.email)}${customer.phone ? ' &middot; ' + esc(customer.phone) : ''}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="border-bottom:2px solid #111;">
          <th style="${th}">Product</th>
          <th style="${th}text-align:center;">Qty</th>
          <th style="${th}text-align:right;">Unit</th>
          <th style="${th}text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="text-align:right;border-top:1px solid #eee;padding-top:14px;">
      <p style="font-size:12px;color:#666;padding:3px 0;margin:0;">Subtotal: R ${Number(sub || 0).toFixed(2)}</p>
      ${ship > 0 ? `<p style="font-size:12px;color:#666;padding:3px 0;margin:0;">Shipping (${esc(fulfilLabel || '')}): R ${Number(ship).toFixed(2)}</p>` : ''}
      ${disc > 0 ? `<p style="font-size:12px;color:#666;padding:3px 0;margin:0;">Discount: &minus; R${Number(disc).toFixed(2)}</p>` : ''}
      <p style="font-family:${bebas};font-size:24px;margin:8px 0 0;">TOTAL: R ${Number(total || 0).toFixed(2)}</p>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;font-size:12px;">
      <strong>Fulfilment:</strong> ${esc(fulfilLabel || '')}${fulfilAddress ? ' &middot; ' + esc(fulfilAddress) : ''}
    </div>
    ${bankSection}
    ${notesSection}
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
      <p style="margin:0;">Artifacts Coffee &middot; hello@artifactscoffee.co.za &middot; artifactscoffee.co.za</p>
      ${!isInvoice ? '<p style="margin:4px 0 0;">This quote is valid for 7 days from the date above.</p>' : ''}
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
