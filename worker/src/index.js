// Auth + preferences API backed by D1, email verification via Resend.
// Routes:
//   POST /api/register            { email, password, displayName }
//   GET  /api/verify?token=...    (link clicked from the verification email)
//   POST /api/resend-verification { email }
//   POST /api/login                { email, password }
//   POST /api/logout
//   GET  /api/me
//   POST /api/profile              { displayName }
//   POST /api/prefs                { ...merged into stored preferences }

const SESSION_DAYS = 30;
const VERIFY_HOURS = 24;
const ALLOWED_EMAIL_DOMAIN = "@descomm.com";

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

function html(body, status, headers) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
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
    .prepare("SELECT users.id, users.email, users.display_name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > datetime('now')")
    .bind(token)
    .first();
  return row || null;
}

async function sendVerificationEmail(env, toEmail, token, workerOrigin) {
  const verifyUrl = `${workerOrigin}/api/verify?token=${token}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: toEmail,
      subject: "Verify your DES Tools account",
      html: `<p>Confirm your email to finish creating your DES Tools account:</p>
             <p><a href="${verifyUrl}">${verifyUrl}</a></p>
             <p>This link expires in ${VERIFY_HOURS} hours.</p>`,
    }),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    // Only enforce origin on browser-scripted (fetch/XHR) requests, which always
    // carry an Origin header. Direct navigation (the verification email link)
    // doesn't send one and must still work.
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "forbidden origin" }, 403, cors);
    }

    const db = env.DB;

    if (url.pathname === "/api/register" && request.method === "POST") {
      const { email, password, displayName } = await request.json();
      const normalizedEmail = (email || "").toLowerCase().trim();
      if (!normalizedEmail.endsWith(ALLOWED_EMAIL_DOMAIN)) {
        return json({ error: `Registration is limited to ${ALLOWED_EMAIL_DOMAIN} emails` }, 400, cors);
      }
      if (!password || password.length < 8) {
        return json({ error: "Password must be at least 8 characters" }, 400, cors);
      }
      if (!displayName || !displayName.trim()) {
        return json({ error: "Display name is required" }, 400, cors);
      }

      const salt = crypto.randomUUID();
      const hash = `${salt}:${await hashPassword(password, salt)}`;
      let userId;
      try {
        const result = await db.prepare(
          "INSERT INTO users (email, password_hash, display_name, email_verified) VALUES (?, ?, ?, 0)"
        ).bind(normalizedEmail, hash, displayName.trim()).run();
        userId = result.meta.last_row_id;
      } catch {
        return json({ error: "Email already registered" }, 409, cors);
      }

      const token = newToken();
      const expires = new Date(Date.now() + VERIFY_HOURS * 3600000).toISOString();
      await db.prepare("INSERT INTO email_verifications (token, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(token, userId, expires).run();
      await sendVerificationEmail(env, normalizedEmail, token, url.origin);

      return json({ ok: true }, 201, cors);
    }

    if (url.pathname === "/api/verify" && request.method === "GET") {
      const token = url.searchParams.get("token") || "";
      const row = await db.prepare(
        "SELECT user_id FROM email_verifications WHERE token = ? AND expires_at > datetime('now')"
      ).bind(token).first();

      if (!row) {
        return html("<p>This verification link is invalid or has expired. Request a new one from the sign-in screen.</p>", 400);
      }

      await db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(row.user_id).run();
      await db.prepare("DELETE FROM email_verifications WHERE token = ?").bind(token).run();

      return html(`<p>Email verified — you can close this tab and sign in at <a href="${env.ALLOWED_ORIGIN}/des-tools-site/">DES Tools</a>.</p>`, 200);
    }

    if (url.pathname === "/api/resend-verification" && request.method === "POST") {
      const { email } = await request.json();
      const normalizedEmail = (email || "").toLowerCase().trim();
      const user = await db.prepare("SELECT id, email_verified FROM users WHERE email = ?")
        .bind(normalizedEmail).first();

      // Always return ok to avoid leaking which emails are registered.
      if (user && !user.email_verified) {
        const token = newToken();
        const expires = new Date(Date.now() + VERIFY_HOURS * 3600000).toISOString();
        await db.prepare("INSERT INTO email_verifications (token, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(token, user.id, expires).run();
        await sendVerificationEmail(env, normalizedEmail, token, url.origin);
      }
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const { email, password } = await request.json();
      const user = await db.prepare("SELECT id, password_hash, email_verified FROM users WHERE email = ?")
        .bind((email || "").toLowerCase().trim()).first();
      if (!user) return json({ error: "Invalid email or password" }, 401, cors);

      const [salt, storedHash] = user.password_hash.split(":");
      const computed = await hashPassword(password, salt);
      if (computed !== storedHash) return json({ error: "Invalid email or password" }, 401, cors);
      if (!user.email_verified) return json({ error: "unverified" }, 403, cors);

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
      return json({
        email: user.email,
        displayName: user.display_name,
        preferences: prefs ? JSON.parse(prefs.data) : {},
      }, 200, cors);
    }

    if (url.pathname === "/api/profile" && request.method === "POST") {
      const user = await getUserFromSession(db, getCookie(request, "session"));
      if (!user) return json({ error: "not authenticated" }, 401, cors);
      const { displayName } = await request.json();
      if (!displayName || !displayName.trim()) {
        return json({ error: "Display name is required" }, 400, cors);
      }
      await db.prepare("UPDATE users SET display_name = ? WHERE id = ?")
        .bind(displayName.trim(), user.id).run();
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === "/api/prefs" && request.method === "POST") {
      const user = await getUserFromSession(db, getCookie(request, "session"));
      if (!user) return json({ error: "not authenticated" }, 401, cors);
      const patch = await request.json();
      const existing = await db.prepare("SELECT data FROM preferences WHERE user_id = ?")
        .bind(user.id).first();
      const merged = { ...(existing ? JSON.parse(existing.data) : {}), ...patch };
      await db.prepare(
        "INSERT INTO preferences (user_id, data, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
      ).bind(user.id, JSON.stringify(merged)).run();
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "not found" }, 404, cors);
  },
};
