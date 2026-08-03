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
 *      env var set in Netlify.
 *   4. Run `ingestOnce` once and approve the Gmail permission prompt.
 *   5. Triggers (clock icon) → add a time-driven trigger: ingestOnce, every 5
 *      minutes.
 *
 * It only reads matching messages, marks them read, and labels them
 * "crewOS-ingested" so nothing is processed twice.
 */

var ENDPOINT = 'https://bhwcrewos.netlify.app/.netlify/functions/email-ingest';
var SECRET   = 'PASTE_THE_SAME_VALUE_AS_EMAIL_INGEST_SECRET';
var LABEL    = 'crewOS-ingested';

// Senders whose notifications should be forwarded. Add to this list as needed.
var QUERY = 'newer_than:2d -label:' + LABEL +
  ' (from:no-reply@ifaxapp.com OR from:ifaxapp.com OR from:dialpad.com OR subject:"you received a fax" OR subject:voicemail OR subject:"missed call")';

function ingestOnce() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(QUERY, 0, 25);
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    var anyPosted = false;
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      var payload = {
        secret: SECRET,
        from: m.getFrom(),
        subject: m.getSubject(),
        text: m.getPlainBody(),
        html: m.getBody(),
        receivedISO: m.getDate().toISOString()
      };
      try {
        var res = UrlFetchApp.fetch(ENDPOINT, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        // 2xx = handled (created a row OR intentionally ignored) — safe to mark.
        if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) anyPosted = true;
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
