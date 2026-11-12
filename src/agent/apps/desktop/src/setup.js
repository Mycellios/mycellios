(() => {
  const bridge = window.rakazoSetup;
  document.documentElement.dataset.platform = bridge?.platform ?? "browser";

  const form = document.getElementById("setup");
  const serverUrl = document.getElementById("server-url");
  const panelNew = document.getElementById("panel-new");
  const panelExisting = document.getElementById("panel-existing");
  const stackSection = document.getElementById("stack");
  const stackPhase = document.getElementById("stack-phase");
  const stackOutput = document.getElementById("stack-output");
  const stackDetail = document.getElementById("stack-detail");
  const stackDetails = document.getElementById("stack-details");
  const stackProgress = document.getElementById("stack-progress");
  const stackProgressFill = document.getElementById("stack-progress-fill");
  const stackDockerHelp = document.getElementById("stack-docker-help");
  const status = document.getElementById("status");
  const checkButton = document.getElementById("check");
  const continueButton = document.getElementById("continue");
  const quitButton = document.getElementById("quit");
  const recovery = document.getElementById("recovery");
  const retryButton = document.getElementById("retry");
  const closeButton = document.getElementById("close");
  const advanced = document.getElementById("advanced");
  const subheading = document.getElementById("subheading");
  const recoveryMessage = document.getElementById("recovery-message");
  const recoveryDiagnostic = document.getElementById("recovery-diagnostic");
  const diagnosticDetails = document.getElementById("diagnostic-details");
  const welcome = document.getElementById("welcome");
  const quickConnect = document.getElementById("quick-connect");
  let retrying = false;
  let recovering = true;

  function showRecoveryDiagnostic(message) {
    recoveryDiagnostic.textContent = typeof message === "string" ? message : "";
    recoveryDiagnostic.hidden = !recoveryDiagnostic.textContent;
    diagnosticDetails.hidden = !recoveryDiagnostic.textContent;
  }

  const STACK_POLL_MS = 1000;
  const PHASE_LABELS = {
    "checking-docker": "Preparando este equipo…",
    preparing: "Preparando este equipo…",
    pulling: "Descargando Mycellios…",
    starting: "Abriendo Mycellios…",
    "waiting-healthy": "Ya casi está…",
    ready: "Mycellios está listo.",
  };
  const TERMINAL_PHASES = new Set([
    "idle",
    "docker-missing",
    "docker-not-running",
    "ready",
    "failed",
  ]);
  const PHASE_PROGRESS = {
    "checking-docker": 0.06,
    preparing: 0.12,
    pulling: 0.2,
    starting: 0.82,
    "waiting-healthy": 0.92,
    ready: 1,
  };
  /** Docker reports bytes pulled but never a total, so the bar approaches the next phase without reaching it. */
  const PULL_SPAN = 0.6;
  const PULL_SCALE_BYTES = 1.2e9;

  let defaultLocalUrl = "";
  let cloudUrl = "";
  let stackPolling = false;
  let lastStack = null;
  let lastProgress = 0;
  let detailsOpen = false;
  /** Set when a failure opened the output; a retry closes it again, a person's own click does not. */
  let detailsOpenedByFailure = false;
  /** Resolves the poll wait early when the main process pushes a new state. */
  let wakePoll = null;

  function selectedMode() {
    const checked = form.querySelector('input[name="mode"]:checked');
    return checked === null ? "existing" : checked.value;
  }

  function setStatus(message, tone) {
    status.textContent = message;
    if (tone === undefined) status.removeAttribute("data-tone");
    else status.setAttribute("data-tone", tone);
  }

  let setupBusy = false;
  function setBusy(busy) {
    setupBusy = busy;
    checkButton.disabled = busy;
    continueButton.disabled = busy;
    quickConnect.disabled = busy;
    retryButton.disabled = busy || retrying;
  }

  /** A save in flight cannot be cancelled, so the choice it commits must not change under it. */
  function lockMode(locked) {
    for (const input of form.querySelectorAll('input[name="mode"]')) input.disabled = locked;
  }

  function syncPanels() {
    const mode = selectedMode();
    panelNew.hidden = mode !== "new";
    panelExisting.hidden = mode !== "existing";
    checkButton.hidden = mode !== "existing";
    continueButton.textContent = mode === "new" ? "Preparar este equipo" : "Conectar";
    setStatus("");
  }

  function isDockerPhase(phase) {
    return phase === "docker-missing" || phase === "docker-not-running";
  }

  function downloadedBytes(stack) {
    return Object.values(stack.layerBytes ?? {}).reduce((total, bytes) => total + bytes, 0);
  }

  function formatBytes(bytes) {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
    if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
    return `${Math.round(bytes)} B`;
  }

  function progressFor(stack) {
    const base = PHASE_PROGRESS[stack.phase] ?? 0;
    if (stack.phase !== "pulling") return base;
    return base + PULL_SPAN * (1 - Math.exp(-downloadedBytes(stack) / PULL_SCALE_BYTES));
  }

  function renderProgress(stack) {
    const running = stack.phase in PHASE_PROGRESS;
    stackProgress.hidden = !running;
    if (!running) {
      lastProgress = 0;
      stackProgressFill.style.width = "0%";
      return;
    }
    // A retry restarts at its phase; otherwise the bar only ever moves forward.
    lastProgress =
      stack.phase === "checking-docker"
        ? progressFor(stack)
        : Math.max(lastProgress, progressFor(stack));
    const percent = (lastProgress * 100).toFixed(1);
    stackProgressFill.style.width = `${percent}%`;
    stackProgress.setAttribute("aria-valuenow", percent);
  }

  function renderDetails(stack) {
    const bytes = stack.phase === "pulling" ? downloadedBytes(stack) : 0;
    stackDetail.textContent = bytes > 0 ? `${formatBytes(bytes)} descargados` : "";

    // A new attempt clears the output, so drop an expansion the person did not ask for.
    if (stack.phase === "checking-docker" && detailsOpenedByFailure) {
      detailsOpen = false;
      detailsOpenedByFailure = false;
    }
    const hasOutput = stack.output.length > 0;
    // A failure asks the person to read the output, so open it for them.
    if (stack.phase === "failed" && hasOutput && !detailsOpen) {
      detailsOpen = true;
      detailsOpenedByFailure = true;
    }
    stackDetails.hidden = !hasOutput;
    stackDetails.setAttribute("aria-expanded", String(detailsOpen && hasOutput));
    stackOutput.hidden = !(detailsOpen && hasOutput);
    if (!stackOutput.hidden) {
      stackOutput.textContent = stack.output.join("\n");
      stackOutput.scrollTop = stackOutput.scrollHeight;
    }
  }

  function renderStack(stack) {
    lastStack = stack;
    const { phase } = stack;
    stackSection.hidden = phase === "idle";
    if (phase === "idle") {
      continueButton.textContent = "Preparar este equipo";
      return;
    }
    const failed = isDockerPhase(phase) || phase === "failed";
    stackPhase.textContent = (failed ? stack.message : PHASE_LABELS[phase]) ?? "";
    if (failed) stackPhase.setAttribute("data-tone", "error");
    else if (phase === "ready") stackPhase.setAttribute("data-tone", "ok");
    else stackPhase.removeAttribute("data-tone");

    renderProgress(stack);
    renderDetails(stack);
    stackDockerHelp.hidden = !isDockerPhase(phase);

    if (isDockerPhase(phase)) continueButton.textContent = "Comprobar de nuevo";
    else if (phase === "failed") continueButton.textContent = "Volver a intentar";
    else continueButton.textContent = "Preparar este equipo";
    setBusy(!TERMINAL_PHASES.has(phase));
  }

  async function save(mode, url) {
    setBusy(true);
    lockMode(true);
    setStatus("Conectando…");
    try {
      const saved = await bridge.save({ name: document.getElementById("server-name").value, mode, serverUrl: url });
      if (!saved.ok) { showRecoveryDiagnostic(saved.error); setStatus("No hemos podido conectar. Revisa el enlace y vuelve a intentarlo.", "error"); }
    } catch {
      setStatus("No hemos podido conectar. Vuelve a intentarlo.", "error");
    } finally {
      lockMode(false);
      setBusy(false);
    }
  }

  /** Wakes on the next pushed state, and on the timer if a push is ever missed. */
  function waitForStackChange() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (wakePoll === finish) wakePoll = null;
        resolve();
      };
      wakePoll = finish;
      setTimeout(finish, STACK_POLL_MS);
    });
  }

  /**
   * Follows a start already in flight until it settles. Leaving "This computer"
   * ends the follow so the stack becoming ready never saves over that choice.
   */
  async function followStack() {
    if (stackPolling) return;
    stackPolling = true;
    try {
      while (true) {
        const stack = await bridge.stack.state();
        if (stack === null) throw new Error("Setup is not active");
        // Checked after the await: a mode change during it hands the form to the change
        // handler, and a save it started must stay busy and must not be re-rendered over.
        if (selectedMode() !== "new") return;
        renderStack(stack);
        if (TERMINAL_PHASES.has(stack.phase)) {
          if (stack.phase === "ready" && selectedMode() === "new") {
            const current = await bridge.state();
            if (selectedMode() !== "new") return;
            defaultLocalUrl = current.defaultLocalUrl;
            await save("new", defaultLocalUrl);
          }
          return;
        }
        await waitForStackChange();
      }
    } catch {
      setStatus("No hemos podido completar la preparación. Vuelve a intentarlo.", "error");
      setBusy(false);
    } finally {
      stackPolling = false;
    }
  }

  async function runStack() {
    setStatus("");
    setBusy(true);
    try {
      // A queued start still reads `idle`; leave the panel as it is and let the follow render it.
      const started = await bridge.stack.start();
      if (started !== null && started.phase !== "idle") renderStack(started);
    } catch {
      setStatus("No hemos podido preparar este equipo. Vuelve a intentarlo.", "error");
      setBusy(false);
      return;
    }
    await followStack();
  }

  async function check() {
    const value = serverUrl.value;
    if (value.trim() === "") {
      setStatus("Pega primero el enlace de conexión.", "error");
      return null;
    }

    setBusy(true);
    setStatus("Comprobando conexión…");
    try {
      const result = await bridge.test(value);
      if (result.ok) {
        serverUrl.value = result.url;
        setStatus("Todo listo. Ya puedes conectar.", "ok");
      } else {
        showRecoveryDiagnostic(result.error);
        setStatus("No hemos podido conectar. Comprueba que el enlace esté completo.", "error");
      }
      return result;
    } catch {
      setStatus("No hemos podido comprobar la conexión. Vuelve a intentarlo.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "mode") {
      syncPanels();
      // Unlock Continue/Check immediately; followStack exits on its next poll.
      if (selectedMode() !== "new") setBusy(false);
    }
  });

  checkButton.addEventListener("click", () => {
    void check();
  });

  stackDetails.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    detailsOpenedByFailure = false;
    if (lastStack !== null) renderDetails(lastStack);
  });

  stackDockerHelp.addEventListener("click", (event) => {
    const link = event.target instanceof HTMLElement ? event.target.dataset.link : undefined;
    if (link) void bridge.openLink(link);
  });

  quitButton.addEventListener("click", () => {
    if (bridge === undefined) {
      window.close();
      return;
    }
    void bridge.quit();
  });

  closeButton.addEventListener("click", () => void bridge?.quit());
  retryButton.addEventListener("click", async () => {
    if (retrying || setupBusy || bridge === undefined) return;
    retrying = true;
    setBusy(true);
    retryButton.textContent = "Conectando…";
    recovery.setAttribute("aria-busy", "true");
    try {
      const result = await bridge.retry();
      if (!result.ok) {
        const state = await bridge.state();
        showRecoveryDiagnostic(state?.error);
        recoveryMessage.textContent = "Todavía no hemos podido conectar. Vuelve a intentarlo en unos momentos.";
      }
    } catch {
      recoveryMessage.textContent = "Todavía no hemos podido conectar. Vuelve a intentarlo en unos momentos.";
    } finally {
      retrying = false;
      setBusy(false);
      recovery.removeAttribute("aria-busy");
      retryButton.textContent = "Volver a intentar";
    }
  });

  quickConnect.addEventListener("click", () => {
    if (setupBusy || retrying || !cloudUrl) return;
    void save("existing", cloudUrl);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (setupBusy || retrying) return;
    recovering = false;
    const mode = selectedMode();
    if (mode === "new") void runStack();
    // Cloud is an existing server at a fixed address.
    else void save("existing", mode === "cloud" ? cloudUrl : serverUrl.value);
  });

  /** Pushed state keeps progress moving even when the OS throttles this window's timers. */
  function watchStack() {
    bridge.stack.onChange(() => {
      if (recovering) return;
      wakePoll?.();
      // A follow that ended on an error restarts here instead of leaving the panel frozen;
      // hold the controls until it has rendered the state it is restarting on.
      if (!stackPolling && selectedMode() === "new") {
        setBusy(true);
        void followStack();
      }
    });
  }

  async function init() {
    if (bridge === undefined) {
      setStatus("Abre Mycellios desde la aplicación para continuar.", "error");
      setBusy(true);
      return;
    }

    watchStack();
    // Continue needs the Cloud address and any saved choice before it can submit.
    setBusy(true);
    try {
      const state = await bridge.state();
      if (state === null) throw new Error("Setup is not active");
      const savedServers = document.getElementById("saved-servers");
      async function renderServers() {
        savedServers.replaceChildren();
        const entries = await bridge.servers?.().catch(() => []) ?? [];
        if (!entries.length) return;
        const heading = document.createElement("h2"); heading.textContent = "Tus conexiones"; savedServers.append(heading);
        for (const entry of entries) {
          const row = document.createElement("div"); row.className = "saved-connection";
          const button = document.createElement("button"); button.type = "button"; button.className = "saved-connection-name";
          let name = entry.name;
          try {
            const address = new URL(entry.serverUrl);
            if (!name || name === address.host || name === entry.serverUrl) name =
              ["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ? "Este equipo" : "Mi espacio";
          } catch { name = "Mi espacio"; }
          button.textContent = name;
          button.setAttribute("aria-label", `Elegir ${name}`);
          button.onclick = () => { if (setupBusy) return; document.querySelector(`input[name="mode"][value="${entry.mode}"]`).checked = true; serverUrl.value = entry.serverUrl; document.getElementById("server-name").value = entry.name; syncPanels(); continueButton.focus(); };
          row.append(button);
          if (state.activeServer !== entry.serverUrl) { const forget = document.createElement("button"); forget.type = "button"; forget.className = "link"; forget.textContent = "Quitar";
            forget.onclick = async () => { if (setupBusy) return; try { await bridge.forgetServer(entry.serverUrl); await renderServers(); } catch { setStatus("No se ha podido quitar la conexión.", "error"); } }; row.append(forget); }
          savedServers.append(row);
        }
      }
      await renderServers();
      defaultLocalUrl = state.defaultLocalUrl;
      cloudUrl = state.cloudUrl;
      if (state.manager) {
        document.getElementById("heading").textContent = "Conecta tu espacio";
        subheading.textContent = "Abre Mycellios o usa un enlace que te hayan compartido.";
        form.querySelector("fieldset").hidden = true;
        document.getElementById("mode-existing").checked = true;
      }
      recovering = state.recovery === true;
      showRecoveryDiagnostic(recovering ? state.error : null);
      recovery.hidden = state.recovery !== true;
      welcome.hidden = state.recovery === true;
      if (state.recovery) document.getElementById("heading").textContent = "Volvamos a conectar";
      subheading.hidden = state.recovery === true;
      advanced.open = false;
      serverUrl.value = "";
      if (state.saved !== null && !recovering && !state.manager) {
        const mode = state.saved.mode;
        const modeInput = document.querySelector(`input[name="mode"][value="${mode}"]`);
        if (modeInput !== null) modeInput.checked = true;
        if (mode === "existing") serverUrl.value = state.saved.serverUrl;
      }
      if (state.preferredServer) {
        document.getElementById("mode-existing").checked = true;
        serverUrl.value = state.preferredServer;
        const chosen = ((await bridge.servers?.().catch(() => [])) ?? []).find(entry => entry.serverUrl === state.preferredServer);
        if (chosen) { document.querySelector(`input[name="mode"][value="${chosen.mode}"]`).checked = true; document.getElementById("server-name").value = chosen.name; }
      }
      // A relaunch with the stack down starts it before this window opens; show that
      // attempt instead of the saved mode, and follow it while it is still running.
      // Normal connection recovery never starts, adopts or follows a local server.
      const stack = state.recovery ? null : await bridge.stack.state();
      const attached = stack !== null && stack.phase !== "idle";
      if (attached) advanced.open = true;
      if (attached) document.getElementById("mode-new").checked = true;
      syncPanels();
      setBusy(false);
      if (state.error && !state.recovery) { showRecoveryDiagnostic(state.error); }
      if (state.recovery) {
        return;
      }
      if (attached) {
        renderStack(stack);
        if (!TERMINAL_PHASES.has(stack.phase)) void followStack();
      }
    } catch {
      setStatus("No hemos podido abrir Mycellios. Cierra la aplicación y vuelve a intentarlo.", "error");
      setBusy(true);
    }
  }

  void init();
})();
