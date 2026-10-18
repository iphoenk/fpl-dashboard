import { S, el, esc, fmt, card, table, getJSON, sum } from "../lib.js";
import { line, seriesColor } from "../charts.js";

const LABEL = {
  dashboard: "Dashboard model", fplens: "FPLens", fpl_ep: "FPL ep_next", ppg: "Points per game", form: "FPL form",
  "dashboard (history only)": "Dashboard (history only)", "points per game": "Points per game", "last 3 GW average": "Last 3 GW average",
};
const SHORT = {
  dashboard: "Dashboard", fplens: "FPLens", fpl_ep: "FPL ep", ppg: "PPG", form: "Form",
  "dashboard (history only)": "Dashboard", "points per game": "PPG", "last 3 GW average": "Last 3",
};
const nice = (k) => LABEL[k] || k;

function metricRows(blocks) {
  const rows = [];
  for (const b of blocks) {
    for (const [model, m] of Object.entries(b.models || {})) {
      if (m) rows.push({ gw: b.gw, model: nice(model), avg: b.avg_manager, ...m });
    }
  }
  return rows;
}

const COLS = [
  { k: "gw", label: "GW", get: (r) => r.gw, n: true },
  { k: "model", label: "Model", get: (r) => r.model, fmt: (v) => `<b>${esc(v)}</b>` },
  { k: "rho_active", label: `<span style="text-transform:none">ρ played</span>`, title: "Spearman over players who had already played: the hard test", get: (r) => r.rho_active, n: true, fmt: (v) => fmt(v, 3) },
  { k: "rho_all", label: `<span style="text-transform:none">ρ all</span>`, title: "Spearman over every player, the population FPLens publishes", get: (r) => r.rho_all, n: true, fmt: (v) => fmt(v, 3) },
  { k: "mae", label: "MAE", get: (r) => r.mae, n: true, fmt: (v) => fmt(v, 2) },
  { k: "top20", label: "Top 20", get: (r) => r.top20, n: true, fmt: (v) => `${fmt(v * 100, 0)}%` },
  { k: "captain", label: "Captain", get: (r) => r.captain, n: true, fmt: (v, r) => `${v} <span class="faint small">${esc(r.captain_name || "")}</span>` },
  { k: "xi", label: "XI pts", title: "Points of the model's own £100m squad (best XI + captain, no autosubs)", get: (r) => r.xi, n: true, fmt: (v, r) => `<b>${v ?? "–"}</b>${r.avg != null && v != null ? ` <span class="small ${v >= r.avg ? "gain pos" : "gain neg"}">${v >= r.avg ? "+" : ""}${v - r.avg}</span>` : ""}` },
];

function summary(blocks, title) {
  const by = {};
  for (const b of blocks) for (const [m, r] of Object.entries(b.models || {})) {
    if (!r) continue;
    (by[m] ||= { rho: [], xi: [], cap: [], mae: [], vsAvg: [] });
    if (r.rho_active != null) by[m].rho.push(r.rho_active);
    if (r.xi != null) { by[m].xi.push(r.xi); if (b.avg_manager != null) by[m].vsAvg.push(r.xi - b.avg_manager); }
    by[m].cap.push(r.captain); by[m].mae.push(r.mae);
  }
  const mean = (a) => (a.length ? sum(a) / a.length : null);
  const rows = Object.entries(by).map(([m, v]) => ({
    model: nice(m), gws: v.mae.length, rho: mean(v.rho), mae: mean(v.mae), cap: sum(v.cap), xi: sum(v.xi), vs: sum(v.vsAvg),
  }));
  return card(title, "Averages and totals across the gameweeks scored. Sort by any column.", table(rows, [
    { k: "model", label: "Model", get: (r) => r.model, fmt: (v) => `<b>${esc(v)}</b>` },
    { k: "gws", label: "GWs", get: (r) => r.gws, n: true },
    { k: "rho", label: `<span style="text-transform:none">avg ρ played</span>`, get: (r) => r.rho, n: true, fmt: (v) => fmt(v, 3) },
    { k: "mae", label: "Avg MAE", get: (r) => r.mae, n: true, fmt: (v) => fmt(v, 2) },
    { k: "cap", label: "Captain", get: (r) => r.cap, n: true },
    { k: "xi", label: "XI pts", get: (r) => r.xi, n: true, fmt: (v) => `<b>${v}</b>` },
    { k: "vs", label: "vs avg", get: (r) => r.vs, n: true, fmt: (v) => `<span class="gain ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v}</span>` },
  ], { sort: "rho" }));
}

function xiChart(blocks) {
  const gws = blocks.map((b) => b.gw);
  const models = [...new Set(blocks.flatMap((b) => Object.keys(b.models || {})))];
  const cum = (getter) => { let t = 0; return blocks.map((b) => { const v = getter(b); if (v == null) return null; t += v; return t; }); };
  const series = models.map((m) => ({ name: SHORT[m] || m, values: cum((b) => b.models[m]?.xi) }));
  series.push({ name: "Avg manager", values: cum((b) => b.avg_manager), color: "var(--text-3)", dashed: true });
  const c = card("Cumulative XI points", "What each model's own squad would have scored, gameweek by gameweek, against the average FPL manager (dashed).");
  c.append(line(series, gws.map((g) => `GW${g}`), { aria: "cumulative XI points by model" }));
  return c;
}

export async function renderBench(root) {
  root.innerHTML = `<div class="loading">Loading benchmark…</div>`;
  let B;
  try { B = await getJSON("/data/benchmark.json"); } catch (e) { root.innerHTML = `<div class="empty">No benchmark file yet; it appears after the next build.</div>`; return; }
  root.innerHTML = "";

  root.append(el(`<div class="hero"><h1>Engine benchmark</h1><div class="who">Same players, same metrics, every model</div></div>`));
  root.append(el(`<p class="note">Two kinds of evidence. Forward: each model's projection is logged before the deadline and scored after the gameweek, so nothing can be tuned after the fact. Retro: the dashboard model re-run from history alone for past gameweeks, next to naive baselines. Retro is handicapped (no odds, no line-ups, no injury news) and slightly leaky (today's player list and prices), so treat it as a floor, not a verdict.</p>`));

  // ---- forward
  root.append(el(`<div class="section-title">Forward: logged before the deadline</div>`));
  const fwd = B.forward || [];
  if (!fwd.length) {
    const logged = (B.ledger_gws || []).map((g) => `GW${g}`).join(", ");
    root.append(card("Waiting for the first scored gameweek", "",
      `<p>${logged ? `Projections are being logged for ${logged}. The first forward result appears once that gameweek finishes.` : "The first projection log is written on the next live build."} Models in the ledger: dashboard model, FPLens, FPL's own ep_next, and two naive baselines (points per game, FPL form). If the dashboard model cannot beat points per game, it is not worth its complexity.</p>`));
  } else {
    const g = el(`<div class="grid g2"></div>`);
    g.append(summary(fwd, "Forward summary"));
    g.append(xiChart(fwd));
    root.append(g);
    const t = card("Forward, per gameweek", "");
    t.append(table(metricRows(fwd), COLS, { sort: "gw" }));
    root.append(t);
  }

  // ---- head to head
  const h = B.head_to_head;
  if (h) {
    root.append(el(`<div class="section-title">Head to head with FPLens, GW${h.gw}</div>`));
    root.append(card(`Identical players, GW${h.gw}`, "FPLens' predictions as it logged them before the deadline, against the dashboard model re-run from history only. The dashboard is handicapped here (no odds, line-ups or injuries); the forward table above is the fair fight.",
      table(metricRows([{ gw: h.gw, models: h.models }]), COLS, { sort: "rho_active" })));
  }

  // ---- retro
  const retro = B.retro || [];
  if (retro.length) {
    root.append(el(`<div class="section-title">Retro: history-only re-runs</div>`));
    const g = el(`<div class="grid g2"></div>`);
    g.append(summary(retro, "Retro summary"));
    const models = [...new Set(retro.flatMap((b) => Object.keys(b.models)))];
    const rc = card("Rank correlation by gameweek", "Players who had already played. Higher is better.");
    rc.append(line(models.map((m) => ({ name: SHORT[m] || m, values: retro.map((b) => b.models[m]?.rho_active ?? null) })), retro.map((b) => `GW${b.gw}`), { fmt: (v) => fmt(v, 3), aria: "rank correlation by gameweek" }));
    g.append(rc);
    root.append(g);
    const t = card("Retro, per gameweek", "");
    t.append(table(metricRows(retro), COLS, { sort: "gw" }));
    root.append(t);
  }

  // ---- FPLens' own numbers
  const lp = B.fplens_published || [];
  if (lp.length) {
    root.append(el(`<div class="section-title">FPLens, as it reports itself</div>`));
    root.append(card("FPLens published accuracy (config_d)", "From FPLens' accuracy history. Its rank correlation is over every player, so compare it with the ρ all column, not ρ played.",
      table(lp, [
        { k: "gw", label: "GW", get: (r) => r.gw, n: true },
        { k: "rho_all", label: `<span style="text-transform:none">ρ all</span>`, get: (r) => r.rho_all, n: true, fmt: (v) => fmt(v, 3) },
        { k: "mae", label: "MAE", get: (r) => r.mae, n: true, fmt: (v) => fmt(v, 2) },
        { k: "xi", label: "Its XI pts", get: (r) => r.xi, n: true },
        { k: "avg", label: "Avg manager", get: (r) => r.avg_manager, n: true },
      ], { sort: "gw" })));
  }

  root.append(el(`<div class="section-title">Metrics</div>`));
  root.append(card("How to read this", "",
    `<div class="kv"><span class="k">ρ played</span><span>Spearman between projected and actual points over players who had already played. Picking a team is a ranking problem, so this is the headline.</span>
    <span class="k">ρ all</span><span>Same over every player. Inflated by the many who never play and score zero; shown only to compare with FPLens' published figure.</span>
    <span class="k">MAE</span><span>Mean absolute error. Rewards predicting low for everyone, so never judge a model on MAE alone.</span>
    <span class="k">Top 20</span><span>Share of the actual top 20 scorers that the model had in its top 20.</span>
    <span class="k">Captain</span><span>What the model's single highest projection actually scored.</span>
    <span class="k">XI pts</span><span>The model builds its own £100m squad, picks its XI and captain, and is scored on what they got (no autosubs, no vice). Set against the average manager, this is the number that wins mini-leagues.</span></div>`));
}
