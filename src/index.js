// Course of Nations: backend (Cloudflare Worker).
// Serves the static site from /public and handles /auth/* and /api/*.
// Rule of secrecy: the browser receives only what the signed-in player may see.
// Anything not meant for them never leaves this Worker.

import { GAMES, findGame } from "./games.js";
import { sign, verify, getCookie, cookie } from "./session.js";

const SESSION_COOKIE = "con_session";
const STATE_COOKIE = "con_state";
const SESSION_DAYS = 14;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

function redirectUri(url) {
  return `${url.origin}/auth/callback`;
}

async function currentUser(request, env) {
  if (!env.SESSION_SECRET) return null;
  return verify(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}

function isGM(user, env) {
  const ids = (env.GM_DISCORD_IDS || "").split(",").map((s) => s.trim());
  return !!user && ids.includes(user.id);
}

// ---- Gateway (one per game workbook) ----
async function callGateway(game, env, body) {
  const key = env[game.keySecret];
  if (!game.gateway || !key) {
    return { ok: false, error: "This game's gateway is not configured yet." };
  }
  const res = await fetch(game.gateway, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, key }),
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, error: `Gateway error ${res.status}` };
  return res.json();
}

// ---- Auth ----
async function login(request, env) {
  const url = new URL(request.url);
  if (!env.DISCORD_CLIENT_ID) return json({ error: "Discord sign-in is not configured yet." }, 503);
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(url),
    scope: "identify",
    state,
    prompt: "none",
  });
  return redirect(`https://discord.com/oauth2/authorize?${params}`, {
    "Set-Cookie": cookie(STATE_COOKIE, state, 600),
  });
}

async function callback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== getCookie(request, STATE_COOKIE)) {
    return redirect("/?signin=failed");
  }
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(url),
    }),
  });
  if (!tokenRes.ok) return redirect("/?signin=failed");
  const { access_token } = await tokenRes.json();
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return redirect("/?signin=failed");
  const me = await meRes.json();
  const session = await sign(
    {
      id: me.id,
      name: me.global_name || me.username,
      avatar: me.avatar,
      exp: Date.now() + SESSION_DAYS * 86400 * 1000,
    },
    env.SESSION_SECRET
  );
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, SESSION_DAYS * 86400));
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

function logout() {
  return redirect("/", { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) });
}

// ---- API ----
async function api(request, env, url) {
  const user = await currentUser(request, env);
  const path = url.pathname;

  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/me") {
    if (!user) return json({ signedIn: false });
    return json({ signedIn: true, id: user.id, name: user.name, avatar: user.avatar, gm: isGM(user, env) });
  }

  if (!user) return json({ error: "Sign in first." }, 401);

  if (path === "/api/games") {
    // Each gateway reports which nation (if any) this player holds in its game.
    const list = await Promise.all(
      GAMES.map(async (g) => {
        const gm = isGM(user, env);
        const who = await callGateway(g, env, { action: "whoami", discordId: user.id });
        const nation = who.ok ? who.nation : null;
        if (!nation && !gm) return null;
        return { id: g.id, title: g.title, tagline: g.tagline, page: g.page, nation, gm, configured: who.ok };
      })
    );
    return json({ games: list.filter(Boolean) });
  }

  const m = path.match(/^\/api\/games\/([a-z0-9-]+)\/(view|submit|command|chart|ask|inquiries|gm\/rulings|gm\/decide|gm\/inquiries|gm\/answer)$/);
  if (m) {
    const game = findGame(m[1]);
    if (!game) return json({ error: "No such game." }, 404);
    const action = m[2];
    const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

    // ---- GM's Desk: GM only ----
    if (action.startsWith("gm/")) {
      if (!isGM(user, env)) return json({ error: "GM only." }, 403);
      if (action === "gm/rulings") return json(await callGateway(game, env, { action: "gmRulings" }));
      if (action === "gm/inquiries") return json(await callGateway(game, env, { action: "gmInquiries" }));
      if (request.method !== "POST") return json({ error: "POST only." }, 405);
      const b = await request.json();
      if (action === "gm/decide") return json(await callGateway(game, env, { action: "gmDecide", row: Number(b.row), decision: clip(b.decision, 5000) }));
      if (action === "gm/answer") return json(await callGateway(game, env, { action: "gmAnswer", id: clip(b.id, 20), answer: clip(b.answer, 6000) }));
    }

    // ---- GM's Desk: players' questions (their own only; the gateway checks the nation) ----
    if (action === "inquiries") return json(await callGateway(game, env, { action: "myInquiries", discordId: user.id }));
    if (action === "ask") {
      if (request.method !== "POST") return json({ error: "POST only." }, 405);
      const b = await request.json();
      const q = clip(b.question, 4000).trim();
      if (!q) return json({ ok: false, error: "No question." }, 400);
      return json(await callGateway(game, env, { action: "ask", discordId: user.id, submittedBy: user.name, question: q }));
    }

    if (action === "command") {
      if (!isGM(user, env)) return json({ error: "GM only." }, 403);
      if (request.method !== "POST") return json({ error: "POST only." }, 405);
      const { command } = await request.json();
      if (!["Prepare", "Resolve", "Refresh"].includes(command)) return json({ error: "Unknown command." }, 400);
      return json(await callGateway(game, env, { action: "command", command }));
    }

    // The gateway resolves the player's nation from their Discord ID itself,
    // so a player can never ask for another nation's view.
    // The public star chart of this game: what every player may see.
    if (action === "chart") {
      return json(await callGateway(game, env, { action: "chart" }));
    }

    if (action === "view") {
      return json(await callGateway(game, env, { action: "view", discordId: user.id }));
    }

    if (action === "submit") {
      if (request.method !== "POST") return json({ error: "POST only." }, 405);
      const body = await request.json();
      // Accepts the basket's structured submission, or a bare list of order lines.

      const routine = (Array.isArray(body.routine) ? body.routine : Array.isArray(body.orders) ? body.orders : [])
        .map((l) => clip(l, 2000).trim()).filter(Boolean).slice(0, 80);
      const plans = (Array.isArray(body.plans) ? body.plans : []).slice(0, 5).map((p) => ({
        name: clip(p && p.name, 200).trim(), objective: clip(p && p.objective, 2000),
        orders: clip(p && p.orders, 6000), covert: clip(p && p.covert, 6000), supports: clip(p && p.supports, 500),
      })).filter((p) => p.name);
      const covert = clip(body.covert, 6000).trim();
      const questions = clip(body.questions, 6000).trim();
      if (!routine.length && !plans.length && !covert && !questions) return json({ ok: false, error: "No orders." }, 400);
      return json(
        await callGateway(game, env, {
          action: "submit",
          discordId: user.id,
          submittedBy: user.name,
          orders: routine,
          plans,
          covert,
          questions,
        })
      );
    }
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/login") return login(request, env);
      if (url.pathname === "/auth/callback") return callback(request, env);
      if (url.pathname === "/auth/logout") return logout();
      if (url.pathname.startsWith("/api/")) return api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: "Server error." }, 500);
    }
  },
};
