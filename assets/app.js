const API = "https://des-tools-auth.lgarrett.workers.dev";

// Flip to true once Resend/email verification is confirmed working end to end.
const AUTH_ENABLED = false;

// Add an entry here for each tool submodule to add it to the dashboard nav.
const TOOLS = [
  { slug: "stream-calculator", title: "Stream Calculator", path: "stream-calculator/index.html" },
];

const nav = document.getElementById("tool-nav");
const pageTitle = document.getElementById("page-title");
const content = document.getElementById("content");

function renderNav() {
  nav.innerHTML =
    `<a href="#/" data-slug="">Dashboard</a>` +
    TOOLS.map(t => `<a href="#/${t.slug}" data-slug="${t.slug}">${t.title}</a>`).join("");
}

function renderRoute() {
  const slug = location.hash.replace(/^#\/?/, "");
  const tool = TOOLS.find(t => t.slug === slug);

  nav.querySelectorAll("a").forEach(a => a.classList.toggle("active", a.dataset.slug === slug));

  content.classList.toggle("full-bleed", !!tool);

  if (!tool) {
    pageTitle.textContent = "Dashboard";
    content.innerHTML = `<div class="tools">${TOOLS.map(t =>
      `<a class="tool-card" href="#/${t.slug}"><h3>${t.title}</h3></a>`
    ).join("")}</div>`;
    return;
  }

  pageTitle.textContent = tool.title;
  content.innerHTML = `<iframe class="tool-frame" src="${tool.path}"></iframe>`;
}

renderNav();
renderRoute();
window.addEventListener("hashchange", renderRoute);

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return res.ok ? res.json() : Promise.reject(await res.json().catch(() => ({ error: res.statusText })));
}

// ---- Theme (light / dark / system) ----

const systemDark = matchMedia("(prefers-color-scheme: dark)");
let themeMode = "light";

function resolveTheme(mode) {
  return mode === "system" ? (systemDark.matches ? "dark" : "light") : mode;
}

function applyThemeMode(mode) {
  themeMode = mode;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.dispatchEvent(new CustomEvent("des-tools:theme", { detail: resolved }));
  document.querySelectorAll(".theme-choice").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.themeMode === mode)
  );
}

systemDark.addEventListener("change", () => {
  if (themeMode === "system") applyThemeMode("system");
});

document.querySelectorAll(".theme-choice").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.themeMode;
    applyThemeMode(mode);
    localStorage.setItem("themeMode", mode);
    api("/api/prefs", { method: "POST", body: JSON.stringify({ themeMode: mode }) }).catch(() => {});
    userDropdown.hidden = true;
  });
});

// ---- Session / header ----

const signinBtn = document.getElementById("signin-btn");
const userMenu = document.getElementById("user-menu");
const userMenuBtn = document.getElementById("user-menu-btn");
const userDropdown = document.getElementById("user-dropdown");
const userDisplayName = document.getElementById("user-display-name");
const logoutBtn = document.getElementById("logout-btn");

let currentUser = null;

if (!AUTH_ENABLED) {
  signinBtn.disabled = true;
  signinBtn.title = "Sign-in is temporarily disabled while we verify email delivery.";
}

async function refreshSession() {
  try {
    currentUser = await api("/api/me");
    signinBtn.hidden = true;
    userMenu.hidden = false;
    userDisplayName.textContent = currentUser.displayName || currentUser.email;
    applyThemeMode(currentUser.preferences.themeMode || currentUser.preferences.theme || "system");
  } catch {
    currentUser = null;
    signinBtn.hidden = false;
    userMenu.hidden = true;
    applyThemeMode(localStorage.getItem("themeMode") || localStorage.getItem("theme") || "system");
  }
}

userMenuBtn.addEventListener("click", () => {
  userDropdown.hidden = !userDropdown.hidden;
});
document.addEventListener("click", (e) => {
  if (!userMenu.hidden && !userMenu.contains(e.target)) userDropdown.hidden = true;
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  userDropdown.hidden = true;
  refreshSession();
});

// ---- Sign in / register modal ----

const authModal = document.getElementById("auth-modal");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginMsg = document.getElementById("login-msg");
const registerMsg = document.getElementById("register-msg");

function showForm(which) {
  loginForm.hidden = which !== "login";
  registerForm.hidden = which !== "register";
  loginMsg.textContent = "";
  registerMsg.textContent = "";
}

signinBtn.addEventListener("click", () => {
  if (!AUTH_ENABLED) return;
  showForm("login");
  authModal.showModal();
});
document.getElementById("auth-modal-close").addEventListener("click", () => authModal.close());
document.getElementById("show-register").addEventListener("click", (e) => { e.preventDefault(); showForm("register"); });
document.getElementById("show-login").addEventListener("click", (e) => { e.preventDefault(); showForm("login"); });

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";
  loginMsg.classList.remove("error");
  const email = loginForm.email.value.trim();
  const password = loginForm.password.value;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    authModal.close();
    loginForm.reset();
    await refreshSession();
  } catch (err) {
    loginMsg.classList.add("error");
    if (err.error === "unverified") {
      loginMsg.innerHTML = `Please verify your email first. <a href="#" id="resend-verify">Resend verification email</a>`;
      document.getElementById("resend-verify").addEventListener("click", async (ev) => {
        ev.preventDefault();
        loginMsg.textContent = "Sending...";
        await api("/api/resend-verification", { method: "POST", body: JSON.stringify({ email }) }).catch(() => {});
        loginMsg.textContent = "If that account needs verifying, a new email is on its way.";
      });
    } else {
      loginMsg.textContent = err.error || "Something went wrong.";
    }
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  registerMsg.textContent = "";
  registerMsg.classList.remove("error");
  const displayName = registerForm.displayName.value.trim();
  const email = registerForm.email.value.trim();
  const password = registerForm.password.value;

  if (!email.toLowerCase().endsWith("@descomm.com")) {
    registerMsg.classList.add("error");
    registerMsg.textContent = "This email provider is not supported.";
    return;
  }

  try {
    await api("/api/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) });
    registerForm.reset();
    registerMsg.classList.remove("error");
    registerMsg.textContent = "Account created! Check your inbox for a verification link before signing in.";
  } catch (err) {
    registerMsg.classList.add("error");
    registerMsg.textContent = err.error || "Something went wrong.";
  }
});

// ---- Profile settings modal ----

const profileModal = document.getElementById("profile-modal");
const profileForm = document.getElementById("profile-form");
const profileMsg = document.getElementById("profile-msg");

document.getElementById("profile-btn").addEventListener("click", () => {
  userDropdown.hidden = true;
  profileMsg.textContent = "";
  profileForm.displayName.value = currentUser?.displayName || "";
  profileModal.showModal();
});
document.getElementById("profile-modal-close").addEventListener("click", () => profileModal.close());

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  profileMsg.classList.remove("error");
  try {
    await api("/api/profile", { method: "POST", body: JSON.stringify({ displayName: profileForm.displayName.value.trim() }) });
    await refreshSession();
    profileModal.close();
  } catch (err) {
    profileMsg.classList.add("error");
    profileMsg.textContent = err.error || "Something went wrong.";
  }
});

refreshSession();
