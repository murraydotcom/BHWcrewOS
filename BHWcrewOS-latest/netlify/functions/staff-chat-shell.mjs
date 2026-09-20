// Only this document can be embedded by the explicitly approved staff sites.
// It serves an empty shell; all identity, messages and preferences require CrewOS auth.
export default async function staffChatShell(request) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const ancestors = ["'self'", "https://rcm.bhwmedical.org", "https://bhwrcm.netlify.app", "https://onboarding.bhwmedical.org", "https://welcometobhw.netlify.app", "https://bhw-health-core-ehr-awknhudemq-uk.a.run.app"];
  const extra = String(Netlify.env.get("STAFF_CHAT_FRAME_ORIGINS") || "").split(",").filter(Boolean);
  for (const value of extra) {
    try { const origin = new URL(value.trim()); if (origin.protocol === "https:" && origin.origin === value.trim()) ancestors.push(origin.origin); } catch { /* invalid origins never widen access */ }
  }
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BHW Staff Chat</title><link rel="stylesheet" href="/assets/bhw-tokens.css"><link rel="stylesheet" href="/staff-chat.css"></head><body><main id="staff-chat"><p role="status">Connecting to BHW Staff Chat…</p></main><script type="module" src="/staff-chat-app.mjs"></script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.run.app; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${ancestors.join(" ")}`,
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}
export const config = { path: "/staff-chat" };
