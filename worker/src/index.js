// Minimal auth + preferences API backed by D1.
// Routes: POST /api/register, POST /api/login, POST /api/logout,
//         GET /api/me, POST /api/prefs

const SESSION_DAYS = 30;

function corsHeaders(allowed) {
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  return crypto.randomUUID();
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function getUserFromSession(db, token) {
  if (!token) return null;
  const row = await db
    .prepare("SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > datetime('now')")
    .bind(token)
    .first();
  return row || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "forbidden origin" }, 403, cors);
    }

    const db = env.DB;

    if (url.pathname === "/api/register" && request.method === "POST") {
      const { email, password } = await request.json();
      if (!email || !password || password.length < 8) {
        return json({ error: "email and 8+ char password required" }, 400, cors);
      }
      const salt = crypto.randomUUID();
      const hash = `${salt}:${await hashPassword(password, salt)}`;
      try {
        await db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
          .bind(email.toLowerCase(), hash).run();
      } catch {
        return json({ error: "email already registered" }, 409, cors);
      }
      return json({ ok: true }, 201, cors);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const { email, password } = await request.json();
      const user = await db.prepare("SELECT id, password_hash FROM users WHERE email = ?")
        .bind((email || "").toLowerCase()).first();
      if (!user) return json({ error: "invalid credentials" }, 401, cors);

      const [salt, storedHash] = user.password_hash.split(":");
      const computed = await hashPassword(password, salt);
      if (computed !== storedHash) return json({ error: "invalid credentials" }, 401, cors);

      const token = newToken();
      const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
      await db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(token, user.id, expires).run();

      return json({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_DAYS * 86400}`,
      });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getCookie(request, "session");
      if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return json({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
      });
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const user = await getUserFromSession(db, getCookie(request, "session"));
      if (!user) return json({ error: "not authenticated" }, 401, cors);
      const prefs = await db.prepare("SELECT data FROM preferences WHERE user_id = ?")
        .bind(user.id).first();
      return json({ email: user.email, preferences: prefs ? JSON.parse(prefs.data) : {} }, 200, cors);
    }

    if (url.pathname === "/api/prefs" && request.method === "POST") {
      const user = await getUserFromSession(db, getCookie(request, "session"));
      if (!user) return json({ error: "not authenticated" }, 401, cors);
      const prefs = await request.json();
      await db.prepare(
        "INSERT INTO preferences (user_id, data, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
      ).bind(user.id, JSON.stringify(prefs)).run();
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "not found" }, 404, cors);
  },
};
