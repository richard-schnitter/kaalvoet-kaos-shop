/**
 * KAALVOET KAOS MERCH — free order receiver
 * ---------------------------------------------------------------------------
 * Logs every order into a Google Sheet and saves the proof of payment into a
 * Google Drive folder. Free, no server, no monthly fee.
 *
 * SETUP (about five minutes)
 *
 *  1. Go to https://sheets.new and make a new spreadsheet.
 *     Name it something like "Kaalvoet Kaos orders".
 *  2. Extensions > Apps Script. Delete whatever is in the editor.
 *  3. Paste this whole file in. Save.
 *  4. Edit NOTIFY_EMAIL below to your own address (or leave it blank).
 *  5. Deploy > New deployment > gear icon > Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     Deploy. Approve the permissions it asks for (it needs Drive + Gmail
 *     because it saves files and emails you).
 *  6. Copy the /exec web app URL it gives you.
 *  7. In assets/js/config.js set:
 *       orders: { mode: 'both', endpointUrl: 'PASTE_THE_URL_HERE', ... }
 *  8. Commit and push. Done — orders now land in the sheet automatically and
 *     the buyer can still send you the WhatsApp as a backup.
 *
 * NOTE: after changing this script you must deploy a NEW VERSION
 * (Deploy > Manage deployments > pencil > Version: New version) or the old
 * code keeps running.
 */

var NOTIFY_EMAIL = '';                    // e.g. 'richard@example.com' — blank disables email
var DRIVE_FOLDER = 'Kaalvoet Kaos POPs';  // Drive folder for proof-of-payment files
var SHEET_NAME   = 'Orders';

var HEADERS = [
  'Received', 'Order ref', 'First name', 'Surname', 'Cell', 'Email',
  'Team', 'City', 'Province', 'Delivery method', 'Delivery fee', 'Address',
  'Items', 'Item count', 'Subtotal', 'Total', 'Notes', 'Newsletter',
  'POP file', 'Status',
];

function doPost(e) {
  try {
    var order = JSON.parse(e.postData.contents);

    var popUrl = '';
    if (order.popDataUrl) {
      popUrl = savePop(order.popDataUrl, order.ref, order.pop && order.pop.name);
    }

    var sheet = getSheet();
    var items = (order.items || []).map(function (it) {
      return it.qty + ' x ' + it.name +
        (it.variant ? ' (' + it.variant + ')' : '') +
        ' @ R' + it.unitPrice;
    }).join('\n');

    var c = order.customer || {};
    var d = order.delivery || {};
    var t = order.totals || {};

    sheet.appendRow([
      new Date(),
      order.ref || '',
      c.firstName || '', c.lastName || '', "'" + (c.cell || ''), c.email || '',
      c.team || '', c.city || '', c.province || '',
      d.method || '', d.fee || 0, d.address || '',
      items,
      (order.items || []).reduce(function (n, it) { return n + it.qty; }, 0),
      t.subtotal || 0, t.total || 0,
      order.notes || '',
      order.marketingOptIn ? 'Yes' : 'No',
      popUrl || (order.pop ? order.pop.name + ' (not saved)' : 'None yet'),
      'NEW',
    ]);

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'New order ' + (order.ref || '') + ' — R' + (t.total || 0),
        body: (order.summaryText || JSON.stringify(order, null, 2)).replace(/\*/g, '') +
              (popUrl ? '\n\nProof of payment: ' + popUrl : '\n\nNo proof of payment attached yet.'),
      });
    }

    return json({ ok: true, ref: order.ref });
  } catch (err) {
    // Never lose an order silently — log the raw body so it can be recovered.
    try {
      getSheet('Errors').appendRow([new Date(), String(err), e && e.postData ? e.postData.contents : '']);
    } catch (ignored) { /* nothing more we can do */ }
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'Kaalvoet Kaos order receiver' });
}

/** Decode a data: URL and drop the file into Drive, returning a shareable link. */
function savePop(dataUrl, ref, originalName) {
  var match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return '';

  var mime = match[1];
  var bytes = Utilities.base64Decode(match[2]);
  var ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] || 'jpg');
  var name = (ref || 'order') + '-POP.' + ext;

  var blob = Utilities.newBlob(bytes, mime, name);
  var folder = getFolder(DRIVE_FOLDER);
  var file = folder.createFile(blob);
  if (originalName) file.setDescription('Original filename: ' + originalName);

  return file.getUrl();
}

function getFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getSheet(name) {
  name = name || SHEET_NAME;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(13, 320);   // Items
      sheet.setColumnWidth(17, 240);   // Notes
    } else {
      sheet.appendRow(['When', 'Error', 'Raw payload']);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
