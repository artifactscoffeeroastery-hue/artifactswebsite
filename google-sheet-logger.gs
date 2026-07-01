/**
 * Artifacts Coffee — Quote/Invoice logger for Google Sheets
 *
 * Receives quote & invoice records from admin-order.html and appends a row.
 * Deploy this as a Web App (see setup steps at the bottom), then paste the
 * resulting /exec URL into SHEET_LOG_URL in admin-order.html.
 */

// Shared secret — must match SHEET_LOG_TOKEN in admin-order.html
var SHEET_LOG_TOKEN = 'aC7logKq9mZ2xR4t';

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return ContentService.createTextOutput('bad json'); }

  // Reject anything without the correct token
  if (d.token !== SHEET_LOG_TOKEN) return ContentService.createTextOutput('unauthorized');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) sheet = ss.insertSheet('Orders');

  // Header row (once)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp','Type','Reference','Name','Email','Phone',
      'Items','Subtotal','Shipping','Discount','Total','Fulfilment','Address','Notes'
    ]);
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    d.timestamp || new Date().toISOString(),
    d.type || '',
    d.ref || '',
    d.name || '',
    d.email || '',
    d.phone || '',
    d.items || '',
    d.subtotal || 0,
    d.shipping || 0,
    d.discount || 0,
    d.total || 0,
    d.fulfilment || '',
    d.address || '',
    d.notes || ''
  ]);

  return ContentService.createTextOutput('ok');
}

/* ─────────────────────────────────────────────────────────────────────────
   ONE-TIME SETUP
   1. Create a new Google Sheet (sheets.new). Name it e.g. "Artifacts Orders".
   2. Extensions → Apps Script. Delete any sample code, paste ALL of this file, Save.
   3. Deploy → New deployment → gear icon → Web app.
        • Description: Artifacts order logger
        • Execute as: Me
        • Who has access: Anyone
      Click Deploy, then Authorize access (approve the Google permission prompt).
   4. Copy the "Web app URL" — it ends in /exec.
   5. In admin-order.html, set:  var SHEET_LOG_URL = 'PASTE_THE_/exec_URL_HERE';
   6. Redeploy the site. From then on, every quote and invoice you create
      appends a row to the "Orders" tab automatically.

   To change the sheet later, just edit the Sheet — the script always writes
   to the "Orders" tab of whichever spreadsheet it's bound to.
   ───────────────────────────────────────────────────────────────────────── */
