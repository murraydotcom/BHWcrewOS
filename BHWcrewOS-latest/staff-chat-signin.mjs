// The opener must be our same-origin chat frame. Never send credentials to an ecosystem host.
const token = sessionStorage.getItem("crewos_token");
if (!token) location.replace("/crewos?next=%2Fstaff-chat-signin.html");
else if (window.opener) {
  window.opener.postMessage({ type: "bhw-chat-signin", token }, location.origin);
  document.getElementById("status").textContent = "Signed in. You can close this window and return to Staff Chat.";
  window.close();
} else location.replace("/staff-chat");
