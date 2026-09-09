/**
 * KAALVOET KAOS MERCH -- order receiver and stock authority
 * ---------------------------------------------------------------------------
 * Does three jobs, all free, no server:
 *
 *   1. Logs every order into a Google Sheet.
 *   2. Saves each proof of payment into a Google Drive folder.
 *   3. Keeps the live claim count per SKU, so an item that has been claimed
 *      shows as SOLD OUT to everyone else -- automatically.
 *
 * SETUP (about five minutes)
 *
 *  1. Go to https://sheets.new and make a new spreadsheet.
 *     Name it something like "Kaalvoet Kaos orders".
 *  2. Extensions > Apps Script. Delete whatever is in the editor.
 *  3. Paste this whole file in. Save.
 *  4. NOTIFY_EMAIL is already set to kaalvoetkaos@gmail.com. Nothing to edit.
 *  5. Deploy > New deployment > gear icon > Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     Deploy. Approve the permissions it asks for (it needs Drive + Gmail
 *     because it saves files and emails you).
 *  6. Copy the /exec web app URL it gives you.
 *  7. In assets/js/config.js set:
 *       orders: { mode: 'both', endpointUrl: 'PASTE_THE_URL_HERE', ... }
 *  8. Commit and push. Orders now land in the sheet, and stock goes to
 *     sold out on its own as people claim things.
 *
 * NOTE: after changing this script you must deploy a NEW VERSION
 * (Deploy > Manage deployments > pencil > Version: New version) or the old
 * code keeps running.
 *
 * ---------------------------------------------------------------------------
 * FREEING UP AN ITEM AGAIN
 *
 * If somebody claims a disc and never pays, open the "Stock" sheet and lower
 * that SKU's Claimed number (or set it to 0). The shop picks it up within a
 * minute. Nothing else to do.
 * ---------------------------------------------------------------------------
 */

var NOTIFY_EMAIL = 'kaalvoetkaos@gmail.com';   // every order is emailed here; blank disables it
var DRIVE_FOLDER = 'Kaalvoet Kaos POPs';  // Drive folder for proof-of-payment files
var SHEET_NAME   = 'Orders';
var STOCK_SHEET  = 'Stock';

// Hard limits, so a hostile or broken caller cannot fill your Drive.
var MAX_ITEMS     = 60;
var MAX_POP_CHARS = 14000000;   // ~10MB once base64 is decoded

var HEADERS = [
  'Received', 'Order ref', 'First name', 'Surname', 'Cell', 'Email',
  'Team', 'City', 'Province', 'Delivery method', 'Delivery fee', 'Address',
  'Items', 'Item count', 'Subtotal', 'Total', 'Notes', 'Newsletter',
  'POP file', 'Status',
];

var STOCK_HEADERS = ['SKU', 'Name', 'Claimed', 'Stock at order', 'Last claimed'];

/* ======================================================================
   Reading -- the shop asks for live stock on every page load
   ====================================================================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.stock) {
    return json({ ok: true, claimed: readClaims(), at: new Date().toISOString() });
  }
  return json({ ok: true, service: 'Kaalvoet Kaos order receiver' });
}

/** { SKU: claimedQty } for everything with a claim against it. */
function readClaims() {
  var sheet = getStockSheet();
  var last = sheet.getLastRow();
  var out = {};
  if (last < 2) return out;

  var rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (var i = 0; i < rows.length; i++) {
    var sku = String(rows[i][0] || '').trim();
    var claimed = Number(rows[i][2]) || 0;
    if (sku && claimed > 0) out[sku] = claimed;
  }
  return out;
}

/* ======================================================================
   Writing -- an order claims its items
   ====================================================================== */

function doPost(e) {
  // One writer at a time, so two people cannot claim the last disc at once.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: 'busy, please try again' });
  }

  try {
    var order = JSON.parse(e.postData.contents);
    var items = order.items || [];

    // --- Cheap spam filters -------------------------------------------
    // The form carries a hidden field no person can see. If it came back
    // filled in, or the whole form was completed in under three seconds,
    // it was a bot. Answer as if it worked so it learns nothing.
    if (order.hp) return json({ ok: true, ref: order.ref });
    if (order.filledInMs && order.filledInMs < 3000) return json({ ok: true, ref: order.ref });

    // Refuse anything absurd before it reaches Drive or the sheet.
    if (items.length > MAX_ITEMS) return json({ ok: false, error: 'too many items' });
    if (order.popDataUrl && order.popDataUrl.length > MAX_POP_CHARS) {
      return json({ ok: false, error: 'proof of payment too large' });
    }

    // 1. Check every item is still available before anything is written.
    var claims = readClaims();
    var unavailable = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var already = Number(claims[it.sku]) || 0;
      var capacity = Number(it.stock);
      // If the shop did not send a stock figure, do not block the order.
      if (!isNaN(capacity) && already + Number(it.qty || 1) > capacity) {
        unavailable.push({ sku: it.sku, name: it.name, left: Math.max(0, capacity - already) });
      }
    }

    if (unavailable.length) {
      return json({ ok: false, reason: 'unavailable', unavailable: unavailable, claimed: claims });
    }

    // 2. Save the proof of payment, if one came with the order.
    var popUrl = '';
    if (order.popDataUrl) {
      popUrl = savePop(order.popDataUrl, order.ref, order.pop && order.pop.name);
    }

    // 3. Log the order.
    var sheet = getSheet();
    var itemText = items.map(function (it) {
      return it.qty + ' x ' + it.name + (it.variant ? ' (' + it.variant + ')' : '') + ' @ R' + it.unitPrice;
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
      itemText,
      items.reduce(function (n, it) { return n + Number(it.qty || 0); }, 0),
      t.subtotal || 0, t.total || 0,
      order.notes || '',
      order.marketingOptIn ? 'Yes' : 'No',
      popUrl || (order.pop ? order.pop.name + ' (not saved)' : 'None yet'),
      'NEW',
    ]);

    // 4. Claim the stock.
    claimItems(items);

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'New order ' + (order.ref || '') + ' -- R' + (t.total || 0),
        body: (order.summaryText || JSON.stringify(order, null, 2)).replace(/\*/g, '') +
              (popUrl ? '\n\nProof of payment: ' + popUrl : '\n\nNo proof of payment attached yet.'),
      });
    }

    return json({ ok: true, ref: order.ref, claimed: readClaims() });
  } catch (err) {
    // Never lose an order silently -- log the raw body so it can be recovered.
    try {
      getSheet('Errors').appendRow([new Date(), String(err), e && e.postData ? e.postData.contents : '']);
    } catch (ignored) { /* nothing more we can do */ }
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Add each ordered item to the Stock sheet's claim tally. */
function claimItems(items) {
  var sheet = getStockSheet();
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, STOCK_HEADERS.length).getValues() : [];

  var index = {};
  for (var i = 0; i < rows.length; i++) {
    index[String(rows[i][0] || '').trim()] = i + 2;   // sheet row number
  }

  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    if (!it.sku) continue;
    var qty = Number(it.qty || 1);
    var row = index[it.sku];

    if (row) {
      var current = Number(sheet.getRange(row, 3).getValue()) || 0;
      sheet.getRange(row, 3).setValue(current + qty);
      sheet.getRange(row, 5).setValue(new Date());
    } else {
      sheet.appendRow([it.sku, it.name || '', qty, it.stock == null ? '' : it.stock, new Date()]);
      index[it.sku] = sheet.getLastRow();
    }
  }
}

/* ======================================================================
   Helpers
   ====================================================================== */

/** Decode a data: URL and drop the file into Drive, returning a link. */
function savePop(dataUrl, ref, originalName) {
  var match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return '';

  var mime = match[1];
  var bytes = Utilities.base64Decode(match[2]);
  var ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] || 'jpg');
  var name = (ref || 'order') + '-POP.' + ext;

  var blob = Utilities.newBlob(bytes, mime, name);
  var file = getFolder(DRIVE_FOLDER).createFile(blob);
  if (originalName) file.setDescription('Original filename: ' + originalName);

  return file.getUrl();
}

function getFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getStockSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(STOCK_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(STOCK_SHEET);
    sheet.appendRow(STOCK_HEADERS);
    sheet.getRange(1, 1, 1, STOCK_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
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
