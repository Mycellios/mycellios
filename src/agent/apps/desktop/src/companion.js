const root = document.getElementById("root");
const surface = document.createElement("div");
const buttons = new Map();
root.append(surface);
window.companion.onHover(shown => { document.body.dataset.expanded = String(shown); });
window.companion.onState(({ kind, prefs, snapshot }) => {
  document.body.dataset.theme = snapshot.theme;
  for (const key of ["surface", "foreground", "hover", "muted"]) {
    if (snapshot.palette?.[key]) document.body.style.setProperty("--companion-" + key, snapshot.palette[key]);
    else document.body.style.removeProperty("--companion-" + key);
  }
  document.body.dataset.autoHide = String(kind === "dock" && prefs.dock.autoHide);
  document.body.dataset.edge = prefs.dock.edge;
  document.body.dataset.strip = String(prefs.dock.edgeStrip);
  surface.className = "surface " + kind + (kind === "dock" && prefs.dock.edge === "bottom" ? " bottom" : "");
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
