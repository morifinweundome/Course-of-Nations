# Course of Nations

*Chart Your Course. Write Your Story. Build Your Empire.*

Platform for turn-based strategy games played on Discord. One Cloudflare Worker
serves the site (`public/`), Discord sign-in (`/auth/*`) and the API (`/api/*`).
Each game's state lives in its own Google Sheets workbook, reached only through
that workbook's gateway (an Apps Script web app).

## Layout

| Path | Purpose |
|---|---|
| `src/index.js` | Routes: sign-in, session, API, static files |
| `src/session.js` | Signed session cookies |
| `src/games.js` | Register of hosted games and their gateways |
| `public/` | Front end |

## Configuration

Public values sit in `wrangler.toml` under `[vars]`:

- `DISCORD_CLIENT_ID`: the Discord application's Client ID.
- `GM_DISCORD_IDS`: comma-separated Discord user IDs with GM rights.

Secrets are set in the Cloudflare dashboard (Workers & Pages → course-of-nations →
Settings → Variables and Secrets → type *Secret*), never committed:

- `DISCORD_CLIENT_SECRET`: from the Discord developer portal (OAuth2).
- `SESSION_SECRET`: any long random string (at least 32 characters).
- `GATEWAY_KEY_<GAME>`: one per game, matching `keySecret` in `src/games.js`.

The Discord application's Redirect must be `https://<site address>/auth/callback`.

## Rule of secrecy

The browser receives only what the signed-in player may see. Gateways resolve a
player's nation from their Discord ID themselves; the API never accepts a nation
name from the browser.
