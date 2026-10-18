// Player detail dialog: projection breakdown, every source's view, match log.

import { S, POS, esc, fmt, money, pct, signed, teamShort, fixtureChip, statusLabel, loadHistory, table, el, sum } from "./lib.js";
import { bars } from "./charts.js";

const PARTS = [["app", "Appearance"], ["goals", "Goals"], ["assists", "Assists"], ["cs", "Clean sheet"],
  ["gc", "Goals conceded"], ["saves", "Saves"], ["bonus", "Bonus"], ["defcon", "Def. contribution"], ["cards", "Cards"]];

export async function openPlayer(id) {
  const p = S.P.get(+id);
  if (!p) return;
  const dlg = document.getElementById("modal");
  document.getElementById("modal-title").innerHTML = `<h2>${esc(p.fn)}</h2>
    <div class="muted small">${esc(S.teams.get(p.t)?.name)} · ${POS[p.p]} · ${money(p.c)} · owned ${pct(p.sel, 1)} ${p.news ? `· <span class="err">${esc(p.news)}</span>` : ""}</div>`;
  const body = document.getElementById("modal-body");
  body.innerHTML = "";
  const start = S.meta.next_gw;

  const top = el(`<div class="grid g2"></div>`);
  // Projection breakdown
  const nx = p.nx || { parts: {} };
  const partRows = PARTS.filter(([k]) => Math.abs(nx.parts[k] || 0) >= 0.005)
    .map(([k, label]) => ({ label, v: nx.parts[k], text: signed(nx.parts[k], 2), cls: nx.parts[k] < 0 ? "neg" : "" }));
  const c1 = el(`<div class="card"><h2>GW${start}: ${fmt(p.xp[0], 2)} expected points</h2>
    <p class="sub">${statusLabel(p)} · expected minutes ${fmt(nx.emin, 0)} · P(60+) ${pct((nx.p60 || 0) * 100)} · xG ${fmt(nx.xg, 2)} · xA ${fmt(nx.xa, 2)}</p></div>`);
  c1.append(bars(partRows));
  top.append(c1);

  // Every source's opinion
  const lu = p.lu || {};
  const luTxt = (v) => (v == null ? "no data" : v ? "starts" : "benched / out");
  const kv = [
    ["Primary projection", `${fmt(p.xp[0], 2)} (${S.meta.authority === "v12" ? "V12" : "dashboard model"})`],
    ["Dashboard model", fmt(p.xpm?.[0], 2)],
    ["FPLens (LightGBM)", p.fl ? `${fmt(p.fl.pred, 2)} (range ${fmt(p.fl.lo, 1)}–${fmt(p.fl.hi, 1)}) for GW${p.fl.gw}` : "no data"],
    ["FPL's own ep_next", fmt(p.ep, 1)],
    ["Predicted line-up: FFS", luTxt(lu.ffs)],
    ["Predicted line-up: Rotowire", `${luTxt(lu.rotowire)}${lu.flag ? ` · flag ${esc(lu.flag)}` : ""}`],
    ["Season xG / xA (Opta)", `${fmt(p.xg, 2)} / ${fmt(p.xa, 2)} → G ${p.g} A ${p.a}`],
    ["Season xG / xA (Understat)", p.us ? `${fmt(p.us.us_xg, 2)} / ${fmt(p.us.us_xa, 2)} · ${p.us.us_shots} shots, ${p.us.us_kp} key passes` : "no data"],
    ["Big chances (Opta)", p.op ? `created ${p.op.bcc ?? 0}, missed ${p.op.bcm ?? 0}, shots ${p.op.shots ?? 0} (${p.op.sot ?? 0} on target)` : "no data"],
    ["Proven-manager ownership", p.el ? `${pct(p.el.own, 1)} ± ${fmt(p.el.moe, 1)} · captained ${pct(p.el.cap, 1)}` : "no data"],
    ["Set pieces", [p.pen && `pens #${p.pen}`, p.cor && `corners #${p.cor}`, p.dfk && `free kicks #${p.dfk}`].filter(Boolean).join(" · ") || "none listed"],
    ["Price change progress", p.pcp != null ? `${fmt(p.pcp, 1)}% (100 = change)` : "no data"],
  ];
  top.append(el(`<div class="card"><h2>What each source says</h2><div class="kv" style="margin-top:8px">${kv.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join("")}</div></div>`));
  body.append(top);

  // Upcoming
  const gws = p.xp.map((_, i) => start + i);
  const up = el(`<div class="card" style="margin-top:14px"><h2>Next ${gws.length} gameweeks</h2><p class="sub">Projected points per gameweek; fixture cells shaded by ${p.p <= 2 ? "clean-sheet" : "attacking"} rating.</p>
    <div class="tbl-wrap"><table><thead><tr><th>GW</th>${gws.map((g) => `<th class="n">${g}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>
      <tr><td>Fixture</td>${gws.map((g) => `<td class="n">${fixtureChip(p, g)}</td>`).join("")}<td></td></tr>
      <tr><td>Projection</td>${p.xp.map((v) => `<td class="n"><b>${fmt(v, 1)}</b></td>`).join("")}<td class="n"><b>${fmt(sum(p.xp), 1)}</b></td></tr>
      ${p.fl?.multi ? `<tr><td>FPLens</td>${gws.map((g, i) => `<td class="n">${p.fl.gw && g >= p.fl.gw && p.fl.multi[g - p.fl.gw] != null ? fmt(p.fl.multi[g - p.fl.gw], 1) : "–"}</td>`).join("")}<td></td></tr>` : ""}
    </tbody></table></div></div>`);
  body.append(up);

  // Match log
  const log = el(`<div class="card" style="margin-top:14px"><h2>Match log</h2><p class="sub">From FPL's live data, one row per gameweek.</p><div class="loading">Loading…</div></div>`);
  body.append(log);
  dlg.showModal();
  const hist = await loadHistory();
  const rows = (hist[p.id] || []).map((r) => ({
    gw: r[0], min: r[1], st: r[2], pts: r[3], g: r[4], a: r[5], xg: r[6], xa: r[7], cs: r[8], gc: r[9], sv: r[10],
    b: r[11], bps: r[12], dc: r[13], dcp: r[14], yc: r[15], opp: r[18], home: r[19],
  })).reverse();
  const thr = S.meta.defcon_thresholds[POS[p.p]];
  log.querySelector(".loading").replaceWith(table(rows, [
    { k: "gw", label: "GW", get: (r) => r.gw, n: true },
    { k: "opp", label: "Opp", get: (r) => r.opp.map((o, i) => (r.home[i] ? teamShort(o) : teamShort(o).toLowerCase())).join(", "), nosort: true },
    { k: "min", label: "Min", get: (r) => r.min, n: true },
    { k: "pts", label: "Pts", get: (r) => r.pts, n: true, fmt: (v) => `<b>${v}</b>` },
    { k: "g", label: "G", get: (r) => r.g, n: true },
    { k: "a", label: "A", get: (r) => r.a, n: true },
    { k: "xg", label: "xG", get: (r) => r.xg, n: true, fmt: (v) => fmt(v, 2) },
    { k: "xa", label: "xA", get: (r) => r.xa, n: true, fmt: (v) => fmt(v, 2) },
    ...(p.p <= 2 ? [{ k: "cs", label: "CS", get: (r) => r.cs, n: true }, { k: "gc", label: "GC", get: (r) => r.gc, n: true }] : []),
    ...(p.p === 1 ? [{ k: "sv", label: "Sv", get: (r) => r.sv, n: true }] : []),
    ...(p.p > 1 ? [{ k: "dc", label: "DefCon", title: `Count vs threshold ${thr}`, get: (r) => r.dc, n: true, fmt: (v, r) => `${v}${r.dcp ? " ✓" : ""}` }] : []),
    { k: "b", label: "B", get: (r) => r.b, n: true },
    { k: "bps", label: "BPS", get: (r) => r.bps, n: true },
  ], { sort: "gw" }));
}

export function initModal() {
  const dlg = document.getElementById("modal");
  document.getElementById("modal-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
}
