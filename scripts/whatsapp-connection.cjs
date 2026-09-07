// One owner per Chromium session. Dependencies are injected for lifecycle tests.
function createConnection({ createClient, encodeQr, clearSession = async () => {}, now = Date.now, startupMs = 90000 }) {
  let client, generation = 0, timer, cleanup = Promise.resolve();
  let state = { status: "DISCONNECTED", qr: null, qrExpiresAt: null, number: null, diagnostic: null };
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const reset = (status, diagnostic = null) => {
    clear();
    state = { status, diagnostic, qr: null, qrExpiresAt: null, number: null };
  };
  async function destroy(old) {
    if (!old) return cleanup;
    cleanup = cleanup.then(async () => {
      let deadline;
      try { await Promise.race([old.destroy().catch(() => {}), new Promise(resolve => { deadline = setTimeout(resolve, 5000); deadline.unref?.(); })]); }
      finally { clearTimeout(deadline); }
    });
    return cleanup;
  }
  async function connect() {
    if (state.status === "READY") return;
    if (state.status === "STARTING") return;
    if (state.status === "QR" && state.qrExpiresAt > now()) return;
    const epoch = ++generation, old = client;
    client = undefined;
    reset("STARTING");
    await destroy(old);
    if (epoch !== generation) return;
    const fail = (diagnostic) => {
      if (epoch !== generation) return;
      ++generation;
      const failed = client; client = undefined;
      reset("FAILED", diagnostic);
      void destroy(failed);
    };
    const deadline = () => {
      clear();
      timer = setTimeout(() => fail("Connection timed out. Check Chromium and outbound access, then reconnect."), startupMs);
      timer.unref?.();
    };
    try {
      const current = createClient(); client = current;
      current.on("qr", async value => {
        try {
          const qr = await encodeQr(value);
          if (epoch !== generation || state.status === "READY") return;
          state = { status: "QR", qr, qrExpiresAt: now() + 45000, number: null, diagnostic: null };
          deadline();
        } catch { fail("QR generation failed. Reconnect to try again."); }
      });
      current.on("authenticated", () => {
        if (epoch !== generation) return;
        reset("STARTING"); deadline();
      });
      current.on("ready", () => {
        if (epoch !== generation) return;
        reset("READY"); state.number = current.info?.wid?.user || null;
      });
      current.on("auth_failure", () => fail("Session authentication failed. Disconnect to clear the saved session, then connect and scan again."));
      current.on("disconnected", () => {
        if (epoch !== generation) return;
        ++generation; client = undefined;
        reset("DISCONNECTED", "Phone disconnected. Reconnect to restore the session.");
        void destroy(current);
      });
      deadline();
      Promise.resolve(current.initialize()).catch(() => fail("Chromium could not initialize WhatsApp. Check the executable, session permissions and outbound network."));
    } catch { fail("Unable to create the browser session. Check Chromium and session directory permissions."); }
  }
  async function disconnect() {
    const old = client; ++generation; client = undefined;
    reset("DISCONNECTED");
    let deadline;
    try {
      if (old) await Promise.race([old.logout(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Logout timed out")), 5000); deadline.unref?.(); })]);
    } catch { /* Clear the local credentials even if the browser is no longer available. */ }
    finally {
      clearTimeout(deadline);
      await destroy(old);
      await clearSession();
    }
  }
  return {
    connect, disconnect,
    snapshot() {
      if (state.status === "QR" && state.qrExpiresAt <= now())
        return { ...state, status: "QR_EXPIRED", qr: null, diagnostic: "QR expired. Reconnect to request another code." };
      return { ...state };
    },
    readyClient() { return state.status === "READY" ? client : undefined; },
    async close() { ++generation; const old = client; client = undefined; reset("DISCONNECTED"); await destroy(old); },
  };
}
module.exports = { createConnection };
