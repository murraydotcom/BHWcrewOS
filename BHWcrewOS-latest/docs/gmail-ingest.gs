/**
 * gmail-ingest.gs — Gmail → BHWcrewOS bridge (Keragon replacement)
 *
 * iFax (ifaxapp.com) and some Dialpad notifications are delivered by EMAIL to
 * info@bhwmedical.org, not by webhook. This Apps Script runs inside that Google
 * account, finds new notification emails, and POSTs them to the Netlify
 * `email-ingest` function, which files them into the Patient Request Triage
 * Queue — so they appear in the Front Desk OS inbox. No middleware.
 *
 * SETUP (once):
 *   1. Sign in to script.google.com as info@bhwmedical.org.
 *   2. New project → paste this file.
 *   3. Set ENDPOINT + SECRET below. SECRET must equal the EMAIL_INGEST_SECRET
 *      env var set in Netlify. Optionally set FAX_DRIVE_FOLDER_ID to file
 *      inbound fax PDFs into a specific Drive folder.
 *   4. Run `ingestOnce` once and approve the Gmail + Drive permission prompt.
 *   5. Triggers (clock icon) → add a time-driven trigger: ingestOnce, every 5
 *      minutes.
 *
 * It only reads matching messages, marks them read, and labels them
 * "crewOS-ingested" so nothing is processed twice. Inbound fax PDFs are saved to
 * Drive and linked on the triage row's Source Link (never shared publicly — the
 * link opens for signed-in workspace members, keeping PHI in the BAA account).
 */

var ENDPOINT = 'https://crewhq.bhwmedical.org/.netlify/functions/email-ingest';
var SECRET   = 'PASTE_THE_SAME_VALUE_AS_EMAIL_INGEST_SECRET';
var LABEL    = 'crewOS-ingested';
// Where to file inbound fax PDFs. Leave '' for My Drive root, or paste a folder
// ID (the part of the folder's URL after /folders/). The file is NOT made
// public — access follows the folder's normal sharing.
var FAX_DRIVE_FOLDER_ID = '';

// Senders whose notifications should be forwarded. `from:ifaxapp.com` matches
// no-reply@ifaxapp.com; `from:dialpad.com` matches voicemail@dialpad.com. The
// subject fallbacks catch forwarded copies (e.g. info@ auto-forwarding to a
// user). Over-matching is safe: email-ingest returns 2xx for anything it
// intentionally ignores (outbound fax confirmations, answered/outbound calls),
// so those just get marked read without creating a queue row.
var QUERY = 'newer_than:2d -label:' + LABEL +
  ' (from:ifaxapp.com OR from:dialpad.com' +
  ' OR subject:"new fax" OR subject:"you received a fax" OR subject:"fax received"' +
  ' OR subject:voicemail OR subject:"missed call")';

function ingestOnce() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(QUERY, 0, 25);
  var seen = {};
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    var anyPosted = false;
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      // Dedupe within this run: iFax delivers the fax notification and a
      // forwarded copy in the same thread; both carry the same PDF, so keying
      // on the PDF name (or subject+date when there's no PDF) files it once.
      var pdfName = firstPdfName(m);
      var key = pdfName ? ('pdf:' + pdfName) : ('msg:' + m.getSubject() + '|' + m.getDate().getTime());
      if (seen[key]) { anyPosted = true; continue; }
      var payload = {
        secret: SECRET,
        from: m.getFrom(),
        subject: m.getSubject(),
        text: m.getPlainBody(),
        html: m.getBody(),
        receivedISO: m.getDate().toISOString()
      };
      var pdf = savePdfToDrive(m);
      if (pdf) { payload.attachmentUrl = pdf.url; payload.attachmentName = pdf.name; }
      try {
        var res = UrlFetchApp.fetch(ENDPOINT, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        // 2xx = handled (created a row OR intentionally ignored) — safe to mark.
        if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) { seen[key] = true; anyPosted = true; }
      } catch (e) {
        // leave it unlabeled so the next run retries
      }
    }
    if (anyPosted) {
      threads[i].addLabel(label);
      threads[i].markRead();
    }
  }
}

// Name of the first PDF attachment on a message (without uploading it), used to
// dedupe an original + forwarded copy of the same fax. '' if there's no PDF.
function firstPdfName(msg) {
  try {
    var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true }) || [];
    for (var k = 0; k < atts.length; k++) {
      var a = atts[k];
      if (/pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName())) return a.getName();
    }
  } catch (e) {}
  return '';
}

// Save the first PDF attachment on a message to Drive; returns {url, name} or
// null. Not shared publicly — the file inherits the target folder's sharing, so
// fax PHI stays inside the workspace.
function savePdfToDrive(msg) {
  try {
    var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true }) || [];
    for (var k = 0; k < atts.length; k++) {
      var a = atts[k];
      if (/pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName())) {
        var folder = FAX_DRIVE_FOLDER_ID ? DriveApp.getFolderById(FAX_DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
        var file = folder.createFile(a.copyBlob());
        return { url: file.getUrl(), name: a.getName() };
      }
    }
  } catch (e) { /* Drive unavailable or no PDF — skip, still ingest the text */ }
  return null;
}
