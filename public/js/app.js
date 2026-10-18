import { S, loadCore, esc, el } from "./lib.js";
import { loadTeam } from "./team.js";
import { initModal } from "./player.js";
import { renderOverview, renderWelcome } from "./views/overview.js";
import { renderPlanning } from "./views/planning.js";
import { renderMarket } from "./views/market.js";
import { renderLeague } from "./views/league.js";
import { renderScout } from "./views/scout.js";
import { renderBench } from "./views/bench.js";

const views = {
  overview: (r) => (S.team ? renderOverview(r) : renderWelcome(r, S.teamError)),
  planning: renderPlanning,
  market: renderMarket,
  league: renderLeague,
  scout: renderScout,
  bench: renderBench,
};
const rendered = new Set();
let current = "overview";

function store(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* storage off */ } }
function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

function show(name) {
  current = name;
  document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (!rendered.has(name)) {
    rendered.add(name);
    const root = document.getElementById(`view-${name}`);
    Promise.resolve(views[name](root)).catch((e) => { root.innerHTML = `<div class="empty err">${esc(e.message)}</div>`; console.error(e); });
  }
  const u = new URL(location.href);
  u.hash = name === "overview" ? "" : name;
  history.replaceState(null, "", u);
}

function rerenderAll() {
  rendered.clear();
  show(current);
}

// League choice belongs to the team that was entered: remembered per team
// ID, defaulting to that team's first private league. Any league ID can also
// be typed in the Mini-league tab.
function pickLeague() {
  const ls = S.team?.leagues || [];
  const urlLeague = +(new URL(location.href).searchParams.get("league") || 0);
  const saved = +(recall(`fpl.league.${S.team?.id}`) || 0);
  S.leagueId = urlLeague || saved || ls[0]?.id || null;
}

export function setLeague(id) {
  S.leagueId = +id;
  if (S.team) store(`fpl.league.${S.team.id}`, S.leagueId);
  const u = new URL(location.href);
  u.searchParams.set("league", S.leagueId);
  history.replaceState(null, "", u);
  rendered.delete("league"); rendered.delete("overview");
  show(current);
}
window.__setLeague = setLeague;

async function setTeam(id) {
  const main = document.getElementById("view-overview");
  main.innerHTML = `<div class="loading">Loading team ${esc(id)}…</div>`;
  S.team = null; S.league = null; S.teamError = null;
  try {
    await loadTeam(id);
    store("fpl.team", id);
    const u = new URL(location.href);
    if (u.searchParams.get("team") !== String(id)) u.searchParams.delete("league");
    u.searchParams.set("team", id);
    history.replaceState(null, "", u);
    pickLeague();
  } catch (e) {
    S.teamError = /→ 404/.test(e.message) ? `Team ID ${id} was not found on FPL.` : `Could not load team ${id}: ${e.message}`;
    console.error(e);
  }
  rerenderAll();
}

function footer() {
  const m = S.meta;
  const built = new Date(m.built_at);
  const ok = (s) => (s.status === "ok" ? "OK" : s.status === "failed" ? "—" : "warn");
  document.getElementById("footer").innerHTML = `
    <p>Data built ${built.toLocaleString()} (rebuilt every three hours). Next deadline GW${m.next_gw}: ${new Date(m.deadline).toLocaleString()}.
    Projections: <b>${m.authority === "v12" ? "V12" : "dashboard model"}</b>${m.authority !== "v12" ? " (V12 slot not published yet)" : ""}; challenger FPLens.
    Sources: FPL API, Pinnacle, Fantasy Football Scout, Rotowire, Opta via Pulselive, Understat via the V6 data plane, FPLens (MIT).
    Personal, non-commercial use.</p>
    <details><summary>Source health this build</summary>
    <table>${m.sources.map((s) => `<tr><td>${ok(s)}</td><td>${esc(s.source)}</td><td>${esc(s.role || "")}</td><td>${esc(s.note)}</td></tr>`).join("")}</table></details>`;
}

// Tap-or-hover tooltips for anything with data-tip (fixture cells etc.),
// because title attributes never show on a phone.
function initTips() {
  const tip = document.getElementById("tip");
  let pinned = null;
  const place = (t) => {
    tip.innerHTML = t.dataset.tip.replace(/ · /g, "<br>");
    tip.classList.add("on");
    const r = t.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  };
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t && t !== pinned) { pinned = t; place(t); return; }
    pinned = null; tip.classList.remove("on");
  });
  document.addEventListener("mouseover", (e) => {
    if (matchMedia("(hover: none)").matches) return;
    const t = e.target.closest("[data-tip]");
    if (t) place(t); else if (!pinned) tip.classList.remove("on");
  });
  window.addEventListener("scroll", () => { pinned = null; tip.classList.remove("on"); }, { passive: true });
}

async function main() {
  initModal();
  const themeSaved = recall("fpl.theme");
  if (themeSaved) document.documentElement.dataset.theme = themeSaved;
  document.getElementById("theme-btn").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store("fpl.theme", next);
  });
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => { show(b.dataset.view); window.scrollTo(0, 0); }));

  try {
    await loadCore();
  } catch (e) {
    document.getElementById("view-overview").innerHTML = `<div class="empty err">Data files could not be loaded: ${esc(e.message)}</div>`;
    return;
  }
  document.getElementById("gw-label").textContent = `GW${S.meta.next_gw} · ${S.meta.authority === "v12" ? "V12" : "model"}`;
  footer();

  const form = document.getElementById("team-form");
  const input = document.getElementById("team-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = input.value.trim();
    if (/^\d{1,10}$/.test(id)) setTeam(id);
  });
  initTips();
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) { e.preventDefault(); show(g.dataset.goto); window.scrollTo(0, 0); }
  });

  const hashView = location.hash.replace("#", "");
  if (views[hashView]) current = hashView;
  const id = new URL(location.href).searchParams.get("team") || recall("fpl.team");
  if (id && /^\d{1,10}$/.test(id)) {
    input.value = id;
    await setTeam(id);
  } else {
    show(current);
  }
}

main();
