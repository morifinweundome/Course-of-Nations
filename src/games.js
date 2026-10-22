// Register of games hosted on the platform.
// Each game is backed by its own workbook, reached through that workbook's
// gateway (an Apps Script web app). The gateway key is a Cloudflare secret
// named in `keySecret`, never stored here.
export const GAMES = [
  {
    id: "starverse-sandbox",
    title: "Starverse Infinitas (sandbox)",
    tagline: "Young interstellar civilisations in an uncharted galaxy.",
    gateway: "", // Apps Script web app URL, filled in once deployed
    keySecret: "GATEWAY_KEY_STARVERSE_SANDBOX",
    timezone: "Asia/Singapore",
  },
];

export function findGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
