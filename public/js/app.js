import { S, loadCore, esc, el } from "./lib.js";
import { loadTeam } from "./team.js";
import { initModal } from "./player.js";
import { renderOverview, renderWelcome } from "./views/overview.js";
import { renderPlanning } from "./views/planning.js";
import { renderMarket } from "./views/market.js";
import { renderLeague } from "./views/league.js";
import { renderScout } from "./views/scout.js";

const views = {
  overview: (r) => (S.team ? renderOverview(r) : renderWelcome(r, S.teamError)),
  planning: renderPlanning,
  market: renderMarket,
  league: renderLeague,
  scout: renderScout,
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

function fillLeagues() {
  const sel = document.getElementById("league-select");
  const ls = S.team?.leagues || [];
  sel.classList.toggle("hidden", !ls.length);
  sel.innerHTML = ls.map((l) => `<option value="${l.id}">${esc(l.name)}${l.league_type === "x" ? "" : " (public)"}</option>`).join("");
  const want = +(new URL(location.href).searchParams.get("league") || recall("fpl.league") || 0);
  S.leagueId = ls.some((l) => l.id === want) ? want : ls[0]?.id;
  if (S.leagueId) sel.value = S.leagueId;
}

async function setTeam(id) {
  const main = document.getElementById("view-overview");
  main.innerHTML = `<div class="loading">Loading team ${esc(id)}…</div>`;
  S.team = null; S.league = null; S.teamError = null;
  try {
    await loadTeam(id);
    store("fpl.team", id);
    const u = new URL(location.href);
    u.searchParams.set("team", id);
    history.replaceState(null, "", u);
    fillLeagues();
  } catch (e) {
    S.teamError = /→ 404/.test(e.message) ? `Team ID ${id} was not found on FPL.` : `Could not load team ${id}: ${e.message}`;
    fillLeagues();
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
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

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
  document.getElementById("league-select").addEventListener("change", (e) => {
    S.leagueId = +e.target.value;
    store("fpl.league", S.leagueId);
    const u = new URL(location.href);
    u.searchParams.set("league", S.leagueId);
    history.replaceState(null, "", u);
    rendered.delete("league"); rendered.delete("overview");
    show(current);
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
