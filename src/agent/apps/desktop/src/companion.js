const root = document.getElementById("root");
const surface = document.createElement("div");
const buttons = new Map();
root.append(surface);
window.companion.onHover(shown => { document.body.dataset.expanded = String(shown); });
window.companion.onState(({ kind, prefs, snapshot, expanded }) => {
  document.body.dataset.theme = snapshot.theme;
  for (const key of ["surface", "foreground", "hover", "muted"]) {
    if (snapshot.palette?.[key]) document.body.style.setProperty("--companion-" + key, snapshot.palette[key]);
    else document.body.style.removeProperty("--companion-" + key);
  }
  document.body.dataset.autoHide = String(kind === "dock" && prefs.dock.autoHide);
  document.body.dataset.edge = prefs.dock.edge;
  document.body.dataset.strip = String(prefs.dock.edgeStrip);
  surface.className = "surface " + kind + (kind === "dock" && prefs.dock.edge === "bottom" ? " bottom" : "");
  if (kind === "island") { renderIsland({ prefs, snapshot, expanded }); return; }
  const agents = kind === "island" ? [...snapshot.agents].sort((a,b) => Number(b.working || b.unread) - Number(a.working || a.unread)).slice(0, 1) : snapshot.agents;
  const ids = new Set(agents.map(agent => agent.id));
  for (const [id, button] of buttons) if (!ids.has(id)) { button.remove(); buttons.delete(id); }
  agents.forEach((agent, index) => {
    let button = buttons.get(agent.id);
    if (!button) {
      button = document.createElement("button"); button.type = "button";
      button.onclick = () => window.companion.select(agent.id);
      const avatar = document.createElement("span"); avatar.className = "avatar";
      const img = document.createElement("img"); img.alt = ""; avatar.append(img); button.append(avatar);
      buttons.set(agent.id, button);
    }
    button.title = agent.name + " · " + agent.status;
    button.className = (agent.working ? "working " : "") + (agent.unread ? "unread" : "");
    button.setAttribute("aria-label", agent.name + " · " + agent.status);
    button.querySelector(".avatar").style.color = agent.color;
    const img = button.querySelector("img"), source = agent.avatar || "assets/icon.png";
    if (img.getAttribute("src") !== source) img.src = source;
    const showCopy = kind === "island" || prefs.dock.results && prefs.dock.edge !== "bottom";
    let copy = button.querySelector(".copy");
    if (showCopy) {
      if (!copy) {
        copy = document.createElement("span"); copy.className = "copy";
        const name = document.createElement("span"); name.className = "name";
        const status = document.createElement("span"); status.className = "status";
        copy.append(name, status); button.append(copy);
      }
      copy.querySelector(".name").textContent = agent.name;
      copy.querySelector(".status").textContent = agent.result || agent.status;
    } else copy?.remove();
    if (surface.children[index] !== button) surface.insertBefore(button, surface.children[index] || null);
  });
});

// No app preload or tokens: this window has only its bounded companion bridge.
let islandPayload;
let islandScope = "";
let islandPrompt;
let islandSignature = "";
let sending = false;
let sendError = false;
const questionDrafts = new Map();
const questionPages = new Map();
function el(tag, className, text) {
  const node = document.createElement(tag); node.className = className || "";
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", kind === "send" ? "M12 19V5m-6 6 6-6 6 6" : "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01M21 11a9 9 0 0 1-9 9H4l-1 1v-8a9 9 0 1 1 18-2Z");
  svg.append(path); return svg;
}
function islandAvatar(agent) {
  const img = el("img", "island-avatar"); img.alt = "";
  img.onerror = () => { img.onerror = null; img.src = "assets/icon.png"; };
  img.src = agent.avatar || "assets/icon.png"; return img;
}
function promptDraft(prompt) {
  if (!questionDrafts.has(prompt.id)) questionDrafts.set(prompt.id, Object.create(null));
  return questionDrafts.get(prompt.id);
}
function questionEntry(prompt, question) {
  const drafts = promptDraft(prompt);
  if (!drafts[question.id]) drafts[question.id] = { questionId: question.id, optionIds: [], text: "" };
  return drafts[question.id];
}
function updateIsland() { islandSignature = ""; if (islandPayload) renderIsland(islandPayload); }
function renderIsland(payload) {
  islandPayload = payload;
  const { snapshot, expanded } = payload;
  if (snapshot.scope !== islandScope) {
    islandScope = snapshot.scope; islandPrompt = undefined; sending = false; sendError = false;
    questionDrafts.clear(); questionPages.clear(); islandSignature = "";
  }
  const prompts = (snapshot.questions || []).filter(prompt => snapshot.agents.some(agent => agent.id === prompt.botId));
  const active = prompts.find(prompt => prompt.id === islandPrompt) || prompts[0];
  if (active?.id !== islandPrompt) { islandPrompt = active?.id; sendError = false; }
  const agent = snapshot.agents.find(agent => agent.id === active?.botId) ||
    snapshot.agents.find(agent => agent.working || agent.unread) || snapshot.agents[0];
  const labels = snapshot.labels || { questions: "Preguntas", asks: "pregunta", later: "Más tarde", open: "Responder en Mycellios",
    placeholder: "O escribe tu propia respuesta", more: "solicitudes más", send: "Enviar respuesta", error: "No se pudo confirmar la respuesta. Abre el chat antes de reintentar.", next: "Siguiente" };
  const signature = JSON.stringify([snapshot.scope, active, agent, expanded, prompts.map(prompt => prompt.id), labels, sending, sendError, questionPages.get(active?.id)]);
  if (signature === islandSignature) return;
  islandSignature = signature;
  const focused = document.activeElement?.classList.contains("island-answer-input");
  surface.replaceChildren(); surface.className = "surface island";
  surface.dataset.open = String(Boolean(expanded && active));
  if (!agent) return;
  if (!expanded || !active) {
    const pill = el("button", "island-pill"); pill.type = "button";
    pill.setAttribute("aria-expanded", "false");
    const description = agent.name + " · " + (active ? labels.questions : agent.status);
    pill.title = description; pill.setAttribute("aria-label", description);
    pill.append(islandAvatar(agent));
    if (active) {
      const badge = el("span", "island-question-badge"); badge.setAttribute("aria-hidden", "true");
      badge.append(icon("question"));
      if (prompts.length > 1) badge.append(el("span", "island-question-total", String(prompts.length)));
      pill.append(badge);
    } else if (agent.working) {
      const activity = el("span", "island-working"); activity.setAttribute("aria-hidden", "true");
      activity.append(el("i"), el("i"), el("i")); pill.append(activity);
    } else {
      const greeting = el("span", "island-greeting", agent.unread ? "•" : "👋");
      greeting.setAttribute("aria-hidden", "true"); pill.append(greeting);
    }
    pill.onclick = () => active ? window.companion.expand(true) : window.companion.select(agent.id);
    surface.append(pill); return;
  }
  const page = Math.min(questionPages.get(active.id) || 0, active.questions.length - 1);
  const question = active.questions[page];
  const entry = questionEntry(active, question);
  const identity = el("div", "island-identity"); identity.append(islandAvatar(agent));
  const identityCopy = el("div", "island-identity-copy");
  identityCopy.append(el("strong", "", agent.name + " " + labels.asks), el("p", "island-question-text", question.question));
  identity.append(identityCopy);
  if (active.questions.length > 1) {
    const progress = el("button", "island-progress", `${page + 1} / ${active.questions.length}`);
    progress.type = "button"; progress.disabled = sending || page === 0;
    progress.title = "Volver a la pregunta anterior";
    progress.onclick = () => { questionPages.set(active.id, page - 1); updateIsland(); };
    identity.append(progress);
  }
  surface.append(identity);
  const options = el("div", "island-question-options");
  question.options.forEach((option, index) => {
    const button = el("button", "island-question-option"); button.type = "button"; button.disabled = sending;
    button.setAttribute("aria-pressed", String(entry.optionIds.includes(option.id)));
    button.append(el("span", "island-option-index", String(index + 1)));
    const copy = el("span", "island-option-copy"); copy.append(el("strong", "", option.label));
    if (option.description) copy.append(el("span", "island-option-description", option.description));
    button.append(copy);
    button.onclick = () => {
      entry.optionIds = question.multiSelect ? entry.optionIds.includes(option.id) ? entry.optionIds.filter(id => id !== option.id) : [...entry.optionIds, option.id] : [option.id];
      if (!question.multiSelect) { entry.text = ""; advance(); } else updateIsland();
    };
    options.append(button);
  });
  surface.append(options);
  const form = el("form", "island-answer-form");
  const input = el("input", "island-answer-input"); input.type = "text"; input.maxLength = 1600;
  input.placeholder = labels.placeholder; input.setAttribute("aria-label", labels.placeholder); input.value = entry.text;
  // Read-only retains keyboard focus during submission, as in the source flow.
  input.readOnly = sending;
  input.oninput = () => { entry.text = input.value; if (!question.multiSelect) entry.optionIds = []; send.disabled = sending || !entry.text.trim() && !entry.optionIds.length; };
  const send = el("button", "island-answer-send"); send.type = "submit"; send.disabled = sending || !entry.text.trim() && !entry.optionIds.length;
  send.setAttribute("aria-label", page < active.questions.length - 1 ? labels.next : labels.send); send.append(icon("send"));
  form.append(input, send); form.onsubmit = event => { event.preventDefault(); advance(); };
  input.onkeydown = event => { if (event.key === "Enter" && event.isComposing) event.preventDefault(); };
  surface.append(form);
  if (sendError) surface.append(el("p", "island-answer-error", labels.error));
  const footer = el("div", "island-question-footer");
  const count = el("button", "island-question-count", prompts.length > 1 ? `+${prompts.length - 1} ${labels.more}` : "");
  count.type = "button"; count.disabled = sending || prompts.length < 2;
  count.onclick = () => { islandPrompt = prompts[(prompts.findIndex(prompt => prompt.id === active.id) + 1) % prompts.length].id; updateIsland(); };
  const later = el("button", "island-later", labels.later); later.type = "button"; later.onclick = () => window.companion.expand(false);
  const open = el("button", "island-open", labels.open); open.type = "button"; open.onclick = () => window.companion.openQuestion(active.id);
  footer.append(count, later, open); surface.append(footer);
  if (focused) input.focus({ preventScroll: true });
  async function advance() {
    if (sending || !entry.optionIds.length && !entry.text.trim()) return;
    if (page < active.questions.length - 1) { questionPages.set(active.id, page + 1); updateIsland(); return; }
    const all = active.questions.map(q => questionEntry(active, q));
    const missing = all.findIndex(answer => !answer.optionIds.length && !answer.text.trim());
    if (missing >= 0) { questionPages.set(active.id, missing); updateIsland(); return; }
    const scope = snapshot.scope;
    sending = true; sendError = false; updateIsland();
    try {
      const outcome = await window.companion.answer({ scope, promptId: active.id, nonce: crypto.randomUUID(), answers: all });
      if (islandScope !== scope) return;
      if (outcome === "error") sendError = true;
    } catch { if (islandScope === scope) sendError = true; }
    finally { if (islandScope === scope) { sending = false; updateIsland(); } }
  }
}
