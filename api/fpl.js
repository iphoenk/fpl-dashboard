// Read-only proxy to the public FPL API for the per-team parts of the page.
//
// The browser cannot call fantasy.premierleague.com directly (no CORS), and
// the static build cannot know which team ID a visitor will type. So this
// function forwards a short whitelist of GET paths, nothing else, and lets
// Vercel's CDN cache each answer for a few minutes so a family of users never
// multiplies load on FPL.

const BASE = "https://fantasy.premierleague.com/api/";

// [pattern, CDN cache seconds]
const ALLOWED = [
  [/^entry\/\d{1,10}\/$/, 120],
  [/^entry\/\d{1,10}\/history\/$/, 300],
  [/^entry\/\d{1,10}\/transfers\/$/, 300],
  [/^entry\/\d{1,10}\/event\/\d{1,2}\/picks\/$/, 300],
  [/^leagues-classic\/\d{1,10}\/standings\/$/, 120],
  [/^element-summary\/\d{1,5}\/$/, 900],
  [/^event\/\d{1,2}\/live\/$/, 60],
  [/^event-status\/$/, 60],
];

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }
  const path = String(req.query.path || "").replace(/^\/+/, "");
  const rule = ALLOWED.find(([re]) => re.test(path));
  if (!rule) {
    res.status(400).json({ error: "path not allowed" });
    return;
  }
  const params = new URLSearchParams();
  const page = req.query.page_standings;
  if (page && /^\d{1,3}$/.test(String(page))) params.set("page_standings", String(page));
  const url = BASE + path + (params.toString() ? `?${params}` : "");

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 fpl-dashboard proxy (personal use)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
    const body = await upstream.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (upstream.ok) {
      res.setHeader("Cache-Control", `public, s-maxage=${rule[1]}, stale-while-revalidate=${rule[1] * 4}`);
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    res.status(upstream.status).send(body);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "upstream unreachable", detail: String(err && err.message || err) });
  }
};
