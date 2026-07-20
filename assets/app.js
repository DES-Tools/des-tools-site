const API = "https://des-tools-auth.YOUR-SUBDOMAIN.workers.dev";

const authBox = document.getElementById("auth-box");
const authForm = document.getElementById("auth-form");
const authMsg = document.getElementById("auth-msg");
const userBox = document.getElementById("user-box");
const userEmail = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeToggle) themeToggle.checked = theme === "dark";
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return res.ok ? res.json() : Promise.reject(await res.json().catch(() => ({ error: res.statusText })));
}

async function refreshSession() {
  try {
    const me = await api("/api/me");
    authBox.hidden = true;
    userBox.hidden = false;
    userEmail.textContent = me.email;
    applyTheme(me.preferences.theme || "light");
  } catch {
    authBox.hidden = false;
    userBox.hidden = true;
    applyTheme(localStorage.getItem("theme") || "light");
  }
}

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = authForm.email.value.trim();
  const password = authForm.password.value;
  const mode = e.submitter?.name === "register" ? "register" : "login";
  authMsg.textContent = "";
  try {
    await api(`/api/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) });
    if (mode === "register") {
      authMsg.textContent = "Account created, log in above.";
    } else {
      await refreshSession();
    }
  } catch (err) {
    authMsg.textContent = err.error || "Something went wrong.";
  }
});

logoutBtn?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  refreshSession();
});

themeToggle?.addEventListener("change", async () => {
  const theme = themeToggle.checked ? "dark" : "light";
  applyTheme(theme);
  localStorage.setItem("theme", theme);
  api("/api/prefs", { method: "POST", body: JSON.stringify({ theme }) }).catch(() => {});
});

applyTheme(localStorage.getItem("theme") || "light");
refreshSession();
