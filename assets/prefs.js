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
