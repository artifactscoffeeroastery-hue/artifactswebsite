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

  // Header row — created once; self-heals to add Customer ID (col O) + Address Data (col P) if missing
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp','Type','Reference','Name','Email','Phone',
      'Items','Subtotal','Shipping','Discount','Total','Fulfilment','Address','Notes','Customer ID','Address Data','Order No'
    ]);
    sheet.setFrozenRows(1);
  } else {
    if (sheet.getRange(1, 15).getValue() !== 'Customer ID')   sheet.getRange(1, 15).setValue('Customer ID');
    if (sheet.getRange(1, 16).getValue() !== 'Address Data')  sheet.getRange(1, 16).setValue('Address Data');
    if (sheet.getRange(1, 17).getValue() !== 'Order No')      sheet.getRange(1, 17).setValue('Order No');
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
    d.notes || '',
    d.customerId || '',
    d.addressData || '',
    d.orderNo || ''
  ]);

  // Colour-code the new row by type: quotes = blue tint, invoices = amber tint
  var lr = sheet.getLastRow();
  sheet.getRange(lr, 1, 1, 17).setBackground(d.type === 'invoice' ? '#fff3cd' : '#d1ecf1');

  return ContentService.createTextOutput('ok');
}

/**
 * doGet — returns the deduped client list as JSONP (for admin autofill).
 * Called as: <script src=".../exec?callback=fn&token=SECRET">
 * Dedupes by Customer ID (falls back to email); keeps the most recent details.
 */
function doGet(e) {
  var cb = (e && e.parameter && e.parameter.callback) || 'callback';
  function out(obj){ return ContentService.createTextOutput(cb + '(' + JSON.stringify(obj) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT); }

  if (!e || !e.parameter || e.parameter.token !== SHEET_LOG_TOKEN) return out({ error: 'unauthorized', clients: [] });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Orders');
  var byKey = {};
  if (sheet && sheet.getLastRow() > 1) {
    // cols: 0 Timestamp,1 Type,2 Ref,3 Name,4 Email,5 Phone,...,12 Address,14 Customer ID,15 Address Data
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();
    rows.forEach(function(r){
      var email = (r[4] || '').toString().trim();
      var name  = (r[3] || '').toString().trim();
      if (!email && !name) return;
      var id  = (r[14] || '').toString().trim();
      var key = id || email.toLowerCase();
      var addr = null;
      try { if (r[15]) addr = JSON.parse(r[15]); } catch (err) { addr = null; }
      // rows are chronological — later rows overwrite, keeping the most recent details
      byKey[key] = { id: id, name: name, email: email, phone: (r[5] || '').toString(), address: (r[12] || '').toString(), addr: addr };
    });
  }
  return out({ clients: Object.keys(byKey).map(function(k){ return byKey[k]; }) });
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
