const API = "https://des-tools-auth.lgarrett.workers.dev";

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
