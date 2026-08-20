(function patientFeedbackPanel() {
  "use strict";
  const API = "https://bhw-medication-api-343692256275.us-east4.run.app";
  const params = new URLSearchParams(location.search);
  const assignmentId = params.get("assignment") || "";
  const token = params.get("token") || "";
  if (!assignmentId || !token) return;

  const style = document.createElement("style");
  style.textContent = `
    @font-face{font-family:Montserrat;src:url('/fonts/Montserrat/Montserrat-Variable.woff2') format('woff2');font-weight:100 900;font-display:swap}
    #bhw-feedback-shell{font-family:Montserrat,system-ui,sans-serif;position:fixed;z-index:2147483640;right:18px;bottom:18px;color:#2e3d45}
    #bhw-feedback-open{border:0;border-radius:999px;background:linear-gradient(120deg,#c68e63,#8f5c3d);color:white;padding:14px 20px;font:700 13px Montserrat,system-ui;box-shadow:0 12px 28px rgba(47,69,81,.28);cursor:pointer}
    #bhw-feedback-panel{display:none;width:min(430px,calc(100vw - 28px));max-height:min(760px,calc(100vh - 28px));overflow:auto;background:#fffdf9;border:1px solid #e9e2d4;border-radius:22px;box-shadow:0 30px 80px rgba(20,32,38,.28)}
    #bhw-feedback-panel[data-open="true"]{display:block}
    .bhwf-head{position:sticky;top:0;background:#2f4551;color:white;padding:19px 20px;display:flex;gap:12px;align-items:start;z-index:1}
    .bhwf-head h2{font:750 17px/1.3 Montserrat,system-ui;margin:0}.bhwf-head p{margin:4px 0 0;color:#dbe5e8;font-size:11px}.bhwf-close{margin-left:auto;border:0;background:transparent;color:white;font-size:22px;cursor:pointer}
    .bhwf-body{padding:20px}.bhwf-note{background:#f5f2ec;border-radius:12px;padding:11px 12px;font-size:11px;line-height:1.5;margin-bottom:16px}
    .bhwf-field{margin:0 0 17px}.bhwf-label{font-size:12px;font-weight:700;margin-bottom:8px;display:block}.bhwf-required{color:#a85846}
    .bhwf-options{display:grid;gap:7px}.bhwf-option{display:flex;align-items:flex-start;gap:8px;border:1px solid #e9e2d4;border-radius:11px;padding:10px 11px;background:#fff;cursor:pointer;font-size:12px}
    .bhwf-option input{margin-top:2px}.bhwf-input{width:100%;border:1px solid #d9d5cc;border-radius:10px;padding:11px;font:500 12px/1.4 Montserrat,system-ui;background:white;color:#2e3d45}
    textarea.bhwf-input{min-height:86px;resize:vertical}.bhwf-status{display:none;margin:12px 0;padding:11px;border-radius:10px;font-size:12px}.bhwf-status.on{display:block}.bhwf-status.error{background:#f8e8e5;color:#7d382e}.bhwf-status.ok{background:#eaf2e7;color:#466243}
    .bhwf-submit{width:100%;border:0;border-radius:999px;background:#5fa9a6;color:white;padding:13px;font:750 12px Montserrat,system-ui;cursor:pointer}.bhwf-submit:disabled{opacity:.55;cursor:wait}
    .bhwf-emergency{font-size:10px;color:#7a7f78;line-height:1.5;margin-top:12px}
    @media(max-width:600px){#bhw-feedback-shell{right:14px;bottom:14px}#bhw-feedback-panel{max-height:calc(100vh - 28px)}}
  `;
  document.head.appendChild(style);

  const shell = document.createElement("div");
  shell.id = "bhw-feedback-shell";
  shell.innerHTML = '<button id="bhw-feedback-open" type="button">Respond to BHW</button><section id="bhw-feedback-panel" role="dialog" aria-modal="true" aria-label="BHW response panel"></section>';
  document.body.appendChild(shell);
  const openButton = shell.querySelector("#bhw-feedback-open");
  const panel = shell.querySelector("#bhw-feedback-panel");

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function fieldFor(question) {
    const wrap = node("div", "bhwf-field");
    const label = node("label", "bhwf-label", question.label);
    if (question.required) label.appendChild(node("span", "bhwf-required", " *"));
    wrap.appendChild(label);
    const choices = question.type === "yes_no" ? ["Yes", "No"] : (question.options || []);
    if (["yes_no", "single", "multi"].includes(question.type)) {
      const options = node("div", "bhwf-options");
      choices.forEach((choice) => {
        const choiceLabel = node("label", "bhwf-option");
        const input = document.createElement("input");
        input.type = question.type === "multi" ? "checkbox" : "radio";
        input.name = question.id;
        input.value = choice;
        input.required = Boolean(question.required && question.type !== "multi");
        choiceLabel.append(input, node("span", "", choice));
        options.appendChild(choiceLabel);
      });
      wrap.appendChild(options);
    } else if (question.type === "scale") {
      const options = node("div", "bhwf-options");
      [1, 2, 3, 4, 5].forEach((choice) => {
        const choiceLabel = node("label", "bhwf-option");
        const input = document.createElement("input");
        input.type = "radio"; input.name = question.id; input.value = String(choice); input.required = Boolean(question.required);
        choiceLabel.append(input, node("span", "", `${choice}${choice === 1 ? " — low" : choice === 5 ? " — high" : ""}`));
        options.appendChild(choiceLabel);
      });
      wrap.appendChild(options);
    } else {
      const input = document.createElement(question.type === "long_text" ? "textarea" : "input");
      input.className = "bhwf-input"; input.name = question.id; input.required = Boolean(question.required); input.maxLength = question.type === "long_text" ? 2000 : 500;
      wrap.appendChild(input);
    }
    return wrap;
  }

  async function load() {
    openButton.disabled = true;
    try {
      const response = await fetch(`${API}/v1/public/content-assignments/${encodeURIComponent(assignmentId)}?token=${encodeURIComponent(token)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This link is unavailable.");
      render(data);
      openButton.disabled = false;
    } catch (_error) {
      openButton.textContent = "Response link unavailable";
    }
  }

  function render(assignment) {
    panel.innerHTML = "";
    const head = node("div", "bhwf-head");
    const heading = node("div");
    heading.append(node("h2", "", "Tell BHW how this went"), node("p", "", assignment.title));
    const close = node("button", "bhwf-close", "×"); close.type = "button"; close.setAttribute("aria-label", "Close response panel");
    head.append(heading, close);
    const form = node("form", "bhwf-body");
    form.appendChild(node("div", "bhwf-note", "Your response goes to the BHW care team for review. Do not use this form for an emergency."));
    const completion = { id: "completionStatus", label: "What would you like us to know?", type: "single", required: true, options: ["I completed this", "I have a question", "I could not follow the plan", "I had a problem", "Please contact me"] };
    form.appendChild(fieldFor(completion));
    (assignment.questions || []).forEach((question) => form.appendChild(fieldFor(question)));
    const feedbackWrap = node("div", "bhwf-field");
    feedbackWrap.append(node("label", "bhwf-label", "Additional feedback or question"));
    const feedback = document.createElement("textarea"); feedback.className = "bhwf-input"; feedback.name = "feedback"; feedback.maxLength = 4000;
    feedbackWrap.appendChild(feedback); form.appendChild(feedbackWrap);
    const urgentLabel = node("label", "bhwf-option");
    const urgent = document.createElement("input"); urgent.type = "checkbox"; urgent.name = "urgentConcern";
    urgentLabel.append(urgent, node("span", "", "I believe this concern needs review today")); form.appendChild(urgentLabel);
    const status = node("div", "bhwf-status"); form.appendChild(status);
    const submit = node("button", "bhwf-submit", "Send response to BHW"); submit.type = "submit"; form.appendChild(submit);
    form.appendChild(node("div", "bhwf-emergency", "This inbox is not monitored continuously. For a medical emergency, call 911. For a mental health or substance-use crisis, call or text 988."));
    panel.append(head, form);
    close.addEventListener("click", () => { panel.dataset.open = "false"; openButton.hidden = false; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const labelToStatus = { "I completed this": "completed", "I have a question": "question", "I could not follow the plan": "unable", "I had a problem": "problem", "Please contact me": "contact_requested" };
      const responses = {};
      (assignment.questions || []).forEach((question) => {
        responses[question.id] = question.type === "multi" ? formData.getAll(question.id) : formData.get(question.id);
      });
      submit.disabled = true; status.className = "bhwf-status";
      try {
        const response = await fetch(`${API}/v1/public/content-submissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          assignmentId, token, completionStatus: labelToStatus[formData.get("completionStatus")] || "completed", responses,
          feedback: formData.get("feedback") || "", urgentConcern: formData.get("urgentConcern") === "on",
        }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to send response");
        status.textContent = "Your response was received by BHW."; status.className = "bhwf-status on ok";
        submit.hidden = true; form.querySelectorAll("input,textarea").forEach((input) => { input.disabled = true; });
      } catch (_error) {
        status.textContent = "We could not send your response. Please try again or contact the office."; status.className = "bhwf-status on error"; submit.disabled = false;
      }
    });
  }

  openButton.addEventListener("click", () => { panel.dataset.open = "true"; openButton.hidden = true; });
  load();
})();
