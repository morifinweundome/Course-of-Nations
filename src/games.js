// Register of games hosted on the platform.
// Each game is backed by its own workbook, reached through that workbook's
// gateway (an Apps Script web app). The gateway key is a Cloudflare secret
// named in `keySecret`, never stored here.
export const GAMES = [
  {
    id: "starverse-sandbox",
    title: "Starverse Infinitas (sandbox)",
    tagline: "Young interstellar civilisations in an uncharted galaxy.",
    gateway: "https://script.google.com/macros/s/AKfycbwV-IdbyShx4_wFZ0ABKpNpiXxDg8o3qnULFyTQZJaFH1-2-AvvOs3geZeoVEy0notnZA/exec",
    keySecret: "GATEWAY_KEY_STARVERSE_SANDBOX",
    page: "/starverse/nation.html",
    timezone: "Asia/Singapore",
  },
];

export function findGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
