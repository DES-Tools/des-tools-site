// Shared preference storage for DES Tools modules.
// Logged in (D1-backed, synced across machines) -> falls back to localStorage
// (this device only) when logged out or the API is unreachable. Login is
// never required: every call resolves either way.
//
// Usage from any tool, standalone or embedded (same GitHub Pages origin
// either way, so this works unmodified in both):
//   <script src="https://des-tools.github.io/des-tools-site/assets/prefs.js"></script>
//   const theme = await DESPrefs.get("theme", "dark");
//   await DESPrefs.set("theme", "light");

(function () {
  const API = "https://des-tools-auth.lgarrett.workers.dev";
  const embedded = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  let cachedMe = null;

  async function me() {
    if (cachedMe) return cachedMe;
    try {
      const res = await fetch(`${API}/api/me`, { credentials: "include" });
      cachedMe = res.ok ? await res.json() : null;
    } catch {
      cachedMe = null;
    }
    return cachedMe;
  }

  window.DESPrefs = {
    // True when running inside the dashboard's tool iframe (same origin,
    // so direct access to the parent document works below).
    embedded,

    // Embedded tools should hide their own theme UI and follow the
    // dashboard's theme instead of managing their own.
    onThemeChange(callback) {
      if (!embedded) return;
      const parentDoc = window.parent.document;
      callback(parentDoc.documentElement.dataset.theme || "light");
      parentDoc.addEventListener("des-tools:theme", (e) => callback(e.detail));
    },

    async get(key, fallback) {
      const session = await me();
      if (session && key in session.preferences) return session.preferences[key];
      const local = localStorage.getItem(key);
      return local === null ? fallback : local;
    },

    async set(key, value) {
      localStorage.setItem(key, value);
      const session = await me();
      if (!session) return;
      try {
        await fetch(`${API}/api/prefs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });
      } catch {
        // offline or API down: local copy above already covers this device
      }
    },
  };
})();
