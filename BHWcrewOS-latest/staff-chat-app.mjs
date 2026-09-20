import { createOperationsCloudClient } from "./provider/operations-queue.mjs";

const root = document.getElementById("staff-chat");
const embedded = window.parent !== window;
const parentOrigin = new URL(location.href).searchParams.get("parentOrigin");
let client, actor, popup, selected = "bhw-team", rooms = [], active = !embedded, busy = false, loading = false;
let nextBefore = null, displayed = [], lastPoll = 0, generation = 0, lastDirectory = 0;
const drafts = new Map(); // Never store message text in localStorage, sessionStorage or URLs.
const $ = (id) => document.getElementById(id);
function parentMessage(message) { if (embedded && parentOrigin) window.parent.postMessage(message, parentOrigin); }
function status(message, error = false) { if ($("status")) { $("status").textContent = message; $("status").classList.toggle("error", error); } }
function draft() { if (!drafts.has(selected)) drafts.set(selected, { text: "", pending: null }); return drafts.get(selected); }
function saveSelected() { if (actor) sessionStorage.setItem(`bhw-staff-chat-room:${actor.id}`, selected); }
function showAuth(message = "Use your existing CrewOS staff sign-in. Chat does not grant access to RCM, clinical records, or HR records.") {
  client = actor = null; generation += 1; displayed = []; drafts.clear();
  root.innerHTML = '<section class="auth"><h1>BHW Staff Chat</h1><p id="auth-message"></p><button id="sign-in" class="primary">Sign in with CrewOS</button><p class="muted">For staff coordination only. Keep patient information in Patient Requests → Team Notes and confidential personnel matters in HR.</p></section>';
  $("auth-message").textContent = message;
  $("sign-in").onclick = () => {
    popup = window.open("/crewos?next=%2Fstaff-chat-signin.html", "bhw-staff-chat-signin", "popup,width=850,height=720");
    if (!popup) $("auth-message").textContent = "Allow the sign-in window for CrewHQ, then try again.";
  };
  parentMessage({ type: "bhw-chat-badge", enabled: false, count: 0 });
}
function fail(error) {
  if (error.status === 401) { showAuth("Your chat session expired. Sign in again. Unsaved drafts were cleared to protect your privacy."); return; }
  status(error.message || "Unable to connect. Your message has not been confirmed saved.", true);
}
function options(select, rows, current) {
  select.replaceChildren(...rows.map((row) => {
    const option = document.createElement("option"); option.value = row.id; option.textContent = row.name; return option;
  }));
  select.value = current;
}
function renderMessages() {
  const list = $("messages");
  const fromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
  const oldHeight = list.scrollHeight, oldTop = list.scrollTop;
  list.replaceChildren();
  for (const message of displayed) {
    const article = document.createElement("article"); article.className = "message";
    const author = document.createElement("strong"); author.textContent = message.authorName;
    const time = document.createElement("small"); time.textContent = new Date(message.createdAt).toLocaleString();
    const text = document.createElement("p"); text.textContent = message.content;
    article.append(author, time, text); list.append(article);
  }
  if (!displayed.length) list.textContent = "No messages yet. Start a staff-only conversation.";
  if (fromBottom < 50) list.scrollTop = list.scrollHeight;
  else list.scrollTop = oldTop + Math.max(0, list.scrollHeight - oldHeight);
  $("older").hidden = !nextBefore;
  $("mark-read").disabled = !displayed.length;
}
function restoreDraft() {
  const saved = draft();
  $("message").value = saved.text; $("message").readOnly = Boolean(saved.pending);
  $("send").textContent = saved.pending ? "Retry save" : "Send";
  $("no-patient-data").checked = Boolean(saved.pending);
}
async function loadMessages(older = false) {
  const room = selected, version = generation;
  const result = await client.staffChat(`rooms/${room}/messages${older && nextBefore ? `?before=${nextBefore}` : ""}`);
  if (room !== selected || version !== generation) return;
  if (older) displayed = [...result.messages, ...displayed];
  else {
    // Keep older loaded pages, replacing only the latest page by immutable message id.
    const seen = new Map([...displayed, ...result.messages].map((row) => [row.id, row]));
    displayed = [...seen.values()].sort((a, b) => a.sequence - b.sequence);
  }
  if (older || !nextBefore || displayed.length <= 50) nextBefore = result.nextBefore;
  renderMessages();
}
async function poll(force = false) {
  if (!client || loading || document.visibilityState !== "visible") return;
  if (!sessionStorage.getItem("crewos_token")) { showAuth(); return; }
  const interval = active ? 12000 : 45000;
  if (!force && Date.now() - lastPoll < interval) return;
  loading = true; lastPoll = Date.now();
  const version = generation;
  try {
    const result = await client.staffChat("rooms");
    if (version !== generation) return;
    rooms = result.rooms;
    if (!rooms.some((room) => room.id === selected)) selected = "bhw-team";
    options($("rooms"), rooms.map((room) => ({ id: room.id, name: `${room.name}${room.unread ? " · new" : ""}` })), selected);
    $("show-badge").checked = result.preferences.showBadge;
    parentMessage({ type: "bhw-chat-badge", enabled: result.preferences.showBadge, count: rooms.filter((room) => room.unread).length });
    if (active) await loadMessages();
    $("connection").textContent = `Connected · checked ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    if (result.truncated) status("Showing the 100 most recently active direct conversations.");
  } catch (error) { if (version === generation) { fail(error); if ($("connection")) $("connection").textContent = "Connection unavailable · retrying"; } }
  finally { loading = false; }
}
async function start() {
  if (!sessionStorage.getItem("crewos_token")) { showAuth(); return; }
  try {
    client = await createOperationsCloudClient();
    if (!client) throw new Error("Staff Chat is not configured yet.");
    const session = await client.staffChat("session", {});
    actor = session.actor; selected = sessionStorage.getItem(`bhw-staff-chat-room:${actor.id}`) || "bhw-team"; rooms = []; displayed = []; generation += 1; lastDirectory = 0;
    root.innerHTML = `<header><div><h1>Staff Chat</h1><div class="muted" id="identity"></div></div><button id="close" aria-label="Close staff chat">Close</button></header>
      <p class="privacy">Staff coordination only—no patient details or confidential HR information. Use Patient Requests → Team Notes for care coordination. Not monitored for emergencies.</p>
      <div class="rooms"><select id="rooms" aria-label="Conversation"><option value="bhw-team">BHW Team</option></select><button id="new-direct">Message a teammate</button></div>
      <section class="directory" id="directory" hidden><label for="people">Choose a teammate</label><select id="people"><option value="">Loading…</option></select><button id="start-direct">Start conversation</button><p class="muted">Staff appear here after opening Staff Chat once.</p></section>
      <button id="older" hidden>Load older messages</button><section class="messages" id="messages" aria-label="Conversation messages" tabindex="0"></section>
      <div class="compose-footer"><button id="mark-read">Mark read</button><span class="muted" id="connection">Connecting…</span></div>
      <form id="compose"><textarea id="message" maxlength="2000" placeholder="Message the team…" aria-label="Staff message" required></textarea><div class="compose-footer"><label><input id="no-patient-data" type="checkbox" required> No patient or confidential HR information</label><button id="send" class="primary">Send</button></div></form>
      <div class="status" id="status" role="status" aria-live="polite"></div><label class="preferences"><input id="show-badge" type="checkbox"> Show unread badge across staff pages (optional)</label>`;
    $("identity").textContent = session.actor.name;
    $("close").hidden = !embedded;
    $("close").onclick = () => parentMessage({ type: "bhw-chat-close" });
    $("message").oninput = () => { draft().text = $("message").value; status("Not saved—draft stays only in this open page."); };
    $("rooms").onchange = async () => {
      if (busy) { $("rooms").value = selected; return; }
      selected = $("rooms").value; saveSelected(); displayed = []; nextBefore = null; generation += 1; restoreDraft(); status(""); renderMessages();
      try { await loadMessages(); } catch (error) { fail(error); }
    };
    $("older").onclick = async () => { $("older").disabled = true; try { await loadMessages(true); } catch (error) { fail(error); } finally { if ($("older")) $("older").disabled = false; } };
    $("mark-read").onclick = async () => {
      const room = selected;
      if (!active || !displayed.length || document.visibilityState !== "visible") return;
      try { await client.staffChat(`rooms/${room}/read`, { sequence: displayed.at(-1).sequence }); await poll(true); } catch (error) { fail(error); }
    };
    $("show-badge").onchange = async () => {
      $("show-badge").disabled = true;
      try { await client.staffChat("preferences", { showBadge: $("show-badge").checked }); status("Notification preference saved to BHW Cloud."); await poll(true); }
      catch (error) { fail(error); $("show-badge").checked = !$("show-badge").checked; }
      finally { if ($("show-badge")) $("show-badge").disabled = false; }
    };
    $("new-direct").onclick = async () => {
      $("directory").hidden = !$("directory").hidden;
      if ($("directory").hidden || Date.now() - lastDirectory < 30000) return;
      try { const result = await client.staffChat("directory"); options($("people"), [{ id: "", name: "Choose a teammate…" }, ...result.people.filter((person) => person.id !== actor.id)], ""); lastDirectory = Date.now(); } catch (error) { fail(error); }
    };
    $("start-direct").onclick = async () => {
      if (busy || !$("people").value) return;
      $("start-direct").disabled = true;
      try { const result = await client.staffChat("direct", { recipientId: $("people").value }); selected = result.id; saveSelected(); displayed = []; nextBefore = null; generation += 1; $("directory").hidden = true; restoreDraft(); await poll(true); }
      catch (error) { fail(error); } finally { if ($("start-direct")) $("start-direct").disabled = false; }
    };
    $("compose").onsubmit = async (event) => {
      event.preventDefault(); if (busy) return;
      const saved = draft(), room = selected;
      if (!saved.pending) saved.pending = { content: $("message").value.trim(), idempotencyKey: crypto.randomUUID(), noPatientData: $("no-patient-data").checked };
      busy = true; $("send").disabled = true; $("message").readOnly = true; status("Saving to BHW Cloud…");
      try {
        const result = await client.staffChat(`rooms/${room}/messages`, saved.pending);
        if (result.message.content !== saved.pending.content || result.message.conversationId !== room) throw new Error("Save confirmation does not match. Retry without changing this message.");
        drafts.delete(room); restoreDraft();
        status(`Saved to BHW Cloud · ${new Date(result.savedAt).toLocaleTimeString()}. Staff only; no SMS or Google Chat sent.`);
        await loadMessages().catch(() => status(`Saved to BHW Cloud · ${new Date(result.savedAt).toLocaleTimeString()}. History refresh is unavailable; do not resend.`));
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 409) saved.pending = null;
        fail(error);
        if (actor) { restoreDraft(); if (saved.pending) status("Save not confirmed. Use Retry save; the same send key prevents a duplicate.", true); }
      } finally { busy = false; if ($("send")) $("send").disabled = false; }
    };
    await poll(true);
  } catch (error) { showAuth(error.message || "Staff Chat is unavailable."); }
}
window.addEventListener("message", async (event) => {
  if (event.origin === location.origin && popup && event.source === popup && event.data?.type === "bhw-chat-signin" && typeof event.data.token === "string") {
    sessionStorage.setItem("crewos_token", event.data.token); popup = null; await start();
  }
  if (embedded && event.source === window.parent && event.origin === parentOrigin && event.data?.type === "bhw-chat-view") { active = event.data.visible === true; if (active) poll(true); }
});
window.addEventListener("beforeunload", (event) => { if ([...drafts.values()].some((value) => value.text || value.pending)) { event.preventDefault(); event.returnValue = ""; } });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && embedded) parentMessage({ type: "bhw-chat-close" }); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(true); });
setInterval(() => poll(), 3000);
parentMessage({ type: "bhw-chat-ready" });
await start();
