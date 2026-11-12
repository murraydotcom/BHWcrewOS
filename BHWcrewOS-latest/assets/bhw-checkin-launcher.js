(function launchAssignedCheckin() {
  "use strict";

  const API = "https://bhw-medication-api-343692256275.us-east4.run.app";
  const root = document.body;
  const app = document.getElementById("app");
  const program = root.dataset.checkinProgram || "";
  const programLabel = root.dataset.programLabel || "BHW";
  const expectedPath = root.dataset.contentPath || "";
  const allowedPrograms = new Set(["primary", "mind", "charmed", "flow"]);
  const params = new URLSearchParams(location.search);
  const assignmentId = params.get("assignment") || "";
  const token = params.get("token") || "";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function unavailable(message) {
    app.innerHTML = `<section class="card"><p class="eyebrow">Private BHW link</p><h1>This check-in link is unavailable.</h1><p>${esc(message)}</p><p>Contact BHW if you need a new link.</p></section>`;
  }

  function render(assignment) {
    const title = String(assignment.title || `${programLabel} Check-In`).trim().slice(0, 200);
    const target = new URL("https://mybhw.com/bhw-checkin.html");
    target.searchParams.set("program", program);
    target.searchParams.set("return", "portal");
    app.innerHTML = `<section class="card"><p class="eyebrow">Assigned through BHW Care Connect</p><h1>${esc(title)}</h1><p>This opens the secure ${esc(programLabel)} check-in in myBHW. You will sign in before any patient information is shown.</p><div class="notice"><strong>Nothing has been submitted yet.</strong> Opening this assignment does not save a check-in. Review your answers and choose <b>Save today&rsquo;s check-in</b> when you are ready.</div><a class="button" id="openCheckin" href="${esc(target.href)}">Sign in and open check-in</a><p class="fine">The private assignment token stays on this page and is not forwarded to myBHW. For an emergency, call 911. For a mental health or substance-use crisis, call or text 988.</p></section>`;
  }

  async function load() {
    if (!assignmentId || !token || !allowedPrograms.has(program) || !expectedPath) {
      unavailable("Please use the complete private link sent by BHW.");
      return;
    }
    try {
      const response = await fetch(`${API}/v1/public/content-assignments/${encodeURIComponent(assignmentId)}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Link unavailable");
      if (data.contentPath !== expectedPath) throw new Error("Wrong check-in assignment");
      render(data);
    } catch {
      unavailable("It may have expired or been revoked.");
    }
  }

  load();
}());
