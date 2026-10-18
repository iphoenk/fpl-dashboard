import { S, POS, el, esc, fmt, money, pct, signed, teamShort, card, table, fixtureChip, rClass, ratingFor, pname, xpSum, sum } from "../lib.js";
import { bestXI, gwVal, singleMoves, pairMoves, buildSquad, horizonScore } from "../opt.js";
import { radar, legend } from "../charts.js";
import { openPlayer } from "../player.js";

const CHIP_NAMES = { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain" };

function moveRow(outs, ins, m) {
  return `<div class="move">
    <div class="out">${outs.map((p) => `${pname(p)} <span class="small">${money(p.c)}</span>`).join("<br>")}</div>
    <div class="faint">→</div>
    <div>${ins.map((p) => `<a href="#" data-id="${p.id}">${esc(p.n)}</a> <span class="faint small">${teamShort(p.t)} ${money(p.c)}</span>`).join("<br>")}</div>
    <div class="gain ${m.net >= 0 ? "pos" : "neg"}" title="gross ${signed(m.gain, 1)}, cost ${signed(m.cost, 1)}m">${signed(m.net, 1)}</div>
  </div>`;
}

export function renderPlanning(root) {
  root.innerHTML = "";
  if (!S.team) {
    root.append(el(`<div class="empty">Load a team ID to see transfers, captaincy and chip plans. The fixture outlook below works without one.</div>`));
    root.append(fixtureOutlook());
    return;
  }
  const T = S.team, H = S.horizon, nextGw = S.meta.next_gw;
  root.append(el(`<div class="controls"><span class="muted">Planning horizon</span>
    <div class="seg" id="hz">${[1, 3, 5, 8].filter((n) => n <= S.meta.horizon).map((n) => `<button aria-pressed="${n === H}" data-n="${n}">${n} GW</button>`).join("")}</div>
    <span class="faint small">Bank ${money(T.bank)} · ${T.ft} free transfer${T.ft === 1 ? "" : "s"} (estimated) · selling price assumed = current price</span></div>`));
  root.querySelector("#hz").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.horizon = +b.dataset.n; renderPlanning(root);
  });
  root.onclick = (e) => {
    const a = e.target.closest("a[data-id]");
    if (a) { e.preventDefault(); openPlayer(a.dataset.id); }
  };

  // ---- buy / sell / keep / avoid
  root.append(el(`<div class="section-title">Your moves over ${H} gameweek${H > 1 ? "s" : ""}</div>`));
  const owned = new Set(T.squad.map((p) => p.id));
  const singles = singleMoves(T.squad, T.bank, T.ft, H, { top: 40 });
  const bestPerOut = new Map();
  for (const m of singles.moves) if (!bestPerOut.has(m.out.id)) bestPerOut.set(m.out.id, m);
  const lists = el(`<div class="grid g4"></div>`);
  const li = (rows, val) => `<ul class="plist">${rows.map(([p, v, extra]) => `<li><span class="l"><a href="#" data-id="${p.id}">${esc(p.n)}</a> <span class="faint small">${teamShort(p.t)} ${POS[p.p]} ${money(p.c)}</span>${extra ? `<br><span class="small faint">${extra}</span>` : ""}</span><span class="r">${val(v)}</span></li>`).join("")}</ul>`;
  const keep = T.squad.map((p) => [p, xpSum(p)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sell = [...bestPerOut.values()].sort((a, b) => b.gain - a.gain).slice(0, 5).map((m) => [m.out, m.gain, `best swap: ${esc(m.inn.n)}`]);
  const buy = S.players.filter((p) => !owned.has(p.id) && p.st !== "u").map((p) => [p, xpSum(p)]).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([p, v]) => [p, v, p.c > T.bank + Math.max(...T.squad.filter((q) => q.p === p.p).map((q) => q.c)) ? "needs funds" : ""]);
  const pop = S.players.filter((p) => !owned.has(p.id) && p.sel >= 10);
  const cut = pop.map((p) => xpSum(p)).sort((a, b) => a - b)[Math.floor(pop.length * 0.4)] ?? 0;
  const avoid = pop.filter((p) => xpSum(p) <= cut).sort((a, b) => b.sel - a.sel).slice(0, 5).map((p) => [p, xpSum(p), `owned ${pct(p.sel, 1)}`]);
  lists.append(card("Buy", `Highest projected totals you do not own.`, li(buy, (v) => fmt(v, 1))));
  lists.append(card("Sell", `Your players with the most to gain from replacing them.`, sell.length ? li(sell, (v) => signed(v, 1)) : `<p class="faint">No affordable upgrade beats your current squad.</p>`));
  lists.append(card("Keep", `Your best projected totals.`, li(keep, (v) => fmt(v, 1))));
  lists.append(card("Avoid", `Popular picks projecting in the bottom 40% of popular picks.`, li(avoid, (v) => fmt(v, 1))));
  root.append(lists);

  // ---- transfers
  const tr = el(`<div class="grid g2"></div>`);
  const top = singles.moves.slice(0, 6);
  tr.append(card("Suggested transfers", `Single moves within your bank, ranked by gain in projected points over ${H} GW (best XI and captain re-picked every week)${singles.hit ? ", net of a 4-point hit" : ""}.`,
    top.length ? top.map((m) => moveRow([m.out], [m.inn], m)).join("") : `<p class="faint">Nothing affordable improves the squad.</p>`));
  const pairsCard = card("Transfer pairings", `Two-for-two moves that one transfer cannot reach${T.ft >= 2 ? "" : `, net of ${Math.max(0, 2 - T.ft) * 4} points in hits`}.`, `<div class="loading">Searching pairs…</div>`);
  tr.append(pairsCard);
  root.append(tr);

  // ---- captaincy
  root.append(el(`<div class="section-title">Captaincy, GW${nextGw}</div>`));
  const best = bestXI(T.squad, gwVal(0));
  const cands = best.xi.slice().sort((a, b) => b.xp[0] - a.xp[0]).slice(0, 4);
  const fxOf = (p) => (S.fxByTeam.get(p.t)?.get(nextGw) || [])[0];
  const axes = [
    { label: "xP", max: Math.max(...cands.map((p) => p.xp[0])) * 1.05, fmt: (v) => fmt(v, 2) },
    { label: "xG", max: Math.max(0.1, ...cands.map((p) => p.nx?.xg ?? 0)) * 1.05, fmt: (v) => fmt(v, 2) },
    { label: "xA", max: Math.max(0.1, ...cands.map((p) => p.nx?.xa ?? 0)) * 1.05, fmt: (v) => fmt(v, 2) },
    { label: "Start %", max: 100, fmt: (v) => `${fmt(v, 0)}%` },
    { label: "Fixture", max: 10, fmt: (v) => `${fmt(v, 1)}/10` },
  ];
  const series = cands.map((p) => ({ name: p.n, values: [p.xp[0], p.nx?.xg ?? 0, p.nx?.xa ?? 0, (p.nx?.pstart ?? 0) * 100, fxOf(p) ? ratingFor(p, fxOf(p)) : 0] }));
  const cap = el(`<div class="grid g2"></div>`);
  const rc = card("Decision matrix", "Top captain options in your best XI on five axes; each axis scaled to the best candidate.");
  rc.append(radar(axes, series, { aria: "captaincy radar" }));
  rc.append(legend(series.map((s) => s.name)));
  cap.append(rc);
  cap.append(card("Captain table", "Elite captaincy = share of proven top managers captaining him (if that feed ran).", table(cands, [
    { k: "n", label: "Player", get: (p) => p.n, fmt: (v, p) => pname(p) },
    { k: "fx", label: "Fixture", get: () => null, nosort: true, fmt: (v, p) => fixtureChip(p, nextGw) },
    { k: "xp", label: "xP", get: (p) => p.xp[0], n: true, fmt: (v) => `<b>${fmt(v, 2)}</b>` },
    { k: "fl", label: "FPLens", get: (p) => (p.fl?.gw === nextGw ? p.fl.pred : null), n: true, fmt: (v) => fmt(v, 2) },
    { k: "ec", label: "Elite C", get: (p) => p.el?.cap, n: true, fmt: (v) => pct(v, 0) },
    { k: "sel", label: "Own", get: (p) => p.sel, n: true, fmt: (v) => pct(v, 1) },
  ], { sort: "xp", id: (p) => p.id, onClick: openPlayer })));
  root.append(cap);

  // ---- chips
  root.append(el(`<div class="section-title">Chips</div>`));
  const chipBox = el(`<div class="grid g2"></div>`);
  const chipCard = card("Best gameweek for each chip", `Within the next ${S.meta.horizon} gameweeks, for chips still unplayed in their window.`, `<div class="loading">Working out chip gains…</div>`);
  const wcCard = card("Wildcard rebuild", `Best squad for ${H} GW within ${money(T.value + T.bank)} (squad value + bank).`, `<div class="loading">Building…</div>`);
  chipBox.append(chipCard, wcCard);
  root.append(chipBox);

  root.append(fixtureOutlook());

  // Heavy searches after first paint.
  setTimeout(() => {
    const pairs = pairMoves(T.squad, T.bank, T.ft, H, { top: 5 });
    const pm = pairs.moves.filter((m) => m.net > (top[0]?.net ?? 0) - 0.01);
    pairsCard.querySelector(".loading").replaceWith(el(`<div>${(pm.length ? pm : pairs.moves.slice(0, 3)).map((m) => moveRow(m.outs, m.ins, m)).join("") || `<p class="faint">No pair beats the best single move.</p>`}</div>`));

    const rowsChip = [];
    const ev = (k) => nextGw + k;
    for (const c of T.chipsLeft) {
      let bestK = null, bestGain = -Infinity, note = "";
      for (let k = 0; k < S.meta.horizon; k++) {
        const g = ev(k);
        if (g < c.start_event || g > c.stop_event) continue;
        let gain = 0;
        if (c.name === "3xc") { const b = bestXI(T.squad, gwVal(k)); gain = b.captain ? b.captain.xp[k] : 0; }
        else if (c.name === "bboost") gain = bestXI(T.squad, gwVal(k)).benchPoints;
        else if (c.name === "freehit") {
          const fh = buildSquad(T.value + T.bank, gwVal(k), { iters: 60 });
          gain = fh ? bestXI(fh.squad, gwVal(k)).points - bestXI(T.squad, gwVal(k)).points : 0;
        } else if (c.name === "wildcard") {
          if (k > 0) continue; // a wildcard's value is the rebuild from now
          const wc = buildSquad(T.value + T.bank, (p) => xpSum(p, H, 0), { iters: 120 });
          gain = wc ? horizonScore(wc.squad, 0, H) - horizonScore(T.squad, 0, H) : 0;
          note = `over ${H} GW`;
        }
        if (gain > bestGain) { bestGain = gain; bestK = g; }
      }
      if (bestK != null) rowsChip.push({ chip: CHIP_NAMES[c.name] || c.name, gw: bestK, gain: bestGain, note, window: `GW${c.start_event}–${c.stop_event}` });
    }
    const used = T.chipsUsed.map((c) => `${CHIP_NAMES[c.name] || c.name} (GW${c.event})`).join(", ");
    const chipDiv = el(`<div></div>`);
    chipDiv.append(table(rowsChip, [
      { k: "chip", label: "Chip", get: (r) => r.chip },
      { k: "window", label: "Window", get: (r) => r.window },
      { k: "gw", label: "Best GW", get: (r) => r.gw, n: true },
      { k: "gain", label: "Projected gain", get: (r) => r.gain, n: true, fmt: (v, r) => `<b>${signed(v, 1)}</b> <span class="faint small">${r.note}</span>` },
    ], { sort: "gain" }));
    chipDiv.append(el(`<p class="note">Played so far: ${used || "none"}. Free Hit and Wildcard gains are against your current squad; Triple Captain is the captain's projection; Bench Boost is the bench's.</p>`));
    chipCard.querySelector(".loading").replaceWith(chipDiv);

    const wc = buildSquad(T.value + T.bank, (p) => xpSum(p, H, 0), { iters: 150 });
    if (!wc) { wcCard.querySelector(".loading").replaceWith(el(`<p class="faint">No legal squad found within budget.</p>`)); return; }
    const wb = bestXI(wc.squad, (p) => xpSum(p, H, 0));
    const ordered = [...wb.xi.sort((a, b) => a.p - b.p || xpSum(b, H) - xpSum(a, H)), ...wb.bench];
    const gain = horizonScore(wc.squad, 0, H) - horizonScore(T.squad, 0, H);
    const wcDiv = el(`<div><p class="sub">Projected ${signed(gain, 1)} over your squad across ${H} GW · cost ${money(wc.cost)}</p></div>`);
    wcDiv.append(table(ordered, [
      { k: "n", label: "Player", get: (p) => p.n, nosort: true, fmt: (v, p) => `${pname(p)} ${owned.has(p.id) ? "" : '<span class="tag in">IN</span>'}${wb.bench.includes(p) ? ' <span class="tag">bench</span>' : ""}` },
      { k: "c", label: "Price", get: (p) => p.c, n: true, fmt: (v) => money(v) },
      { k: "x", label: `xP ${H}GW`, get: (p) => xpSum(p, H), n: true, fmt: (v) => fmt(v, 1) },
    ], { id: (p) => p.id, onClick: openPlayer }));
    wcCard.querySelector(".loading").replaceWith(wcDiv);
  }, 30);
}

export function fixtureOutlook() {
  const wrap = el(`<div><div class="section-title">Fixture outlook</div></div>`);
  const c = card("All 20 clubs", "Ratings 1–10 against every other fixture in the window (10 = best). Odds-priced matches use the bookmaker's lambdas; the rest use the team model.");
  const ctl = el(`<div class="controls">
      <div class="seg" data-k="mode"><button aria-pressed="true" data-v="atk">Attack</button><button aria-pressed="false" data-v="def">Defence</button><button aria-pressed="false" data-v="all">Overall</button></div>
      <div class="seg" data-k="n">${[3, 5, 8].filter((n) => n <= S.meta.horizon).map((n) => `<button aria-pressed="${n === Math.min(5, S.meta.horizon)}" data-v="${n}">${n} GW</button>`).join("")}</div>
      <label class="chk"><input type="checkbox" data-k="target"> Target fixtures (dim below 7.5)</label>
      ${S.team ? `<label class="chk"><input type="checkbox" data-k="owned"> Clubs I own</label>` : ""}
    </div>`);
  const st = { mode: "atk", n: Math.min(5, S.meta.horizon), target: false, owned: false, sort: "avg" };
  const host = el(`<div class="tbl-wrap"></div>`);
  const runs = el(`<div class="grid g2" style="margin-top:12px"></div>`);
  c.append(ctl, host, el(`<div class="legend">Poor ${["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map((r) => `<span class="fx ${r}">&nbsp;</span>`).join("")} Good · <span class="fx blank">–</span> blank</div>`), runs);
  wrap.append(c);

  function val(f) { return st.mode === "atk" ? f.atk : st.mode === "def" ? f.def : (f.atk + f.def) / 2; }
  function draw() {
    const start = S.meta.next_gw, gws = Array.from({ length: st.n }, (_, i) => start + i);
    const ownedTeams = new Set((S.team?.squad || []).map((p) => p.t));
    let rows = [...S.teams.values()].map((t) => {
      const cells = gws.map((g) => S.fxByTeam.get(t.id)?.get(g) || []);
      const vals = cells.flat().map(val);
      const xg = cells.flat().map((f) => (st.mode === "def" ? f.lamAg : f.lamFor));
      return { t, cells, avg: vals.length ? sum(vals) / vals.length : 0, xg: sum(xg) };
    });
    if (st.owned) rows = rows.filter((r) => ownedTeams.has(r.t.id));
    rows.sort((a, b) => b.avg - a.avg);
    host.innerHTML = `<table class="fx-grid sticky"><thead><tr><th>Club</th>${gws.map((g) => `<th>GW${g}</th>`).join("")}<th class="n">Avg</th><th class="n" title="${st.mode === "def" ? "expected goals against" : "expected goals for"} over the window">${st.mode === "def" ? "xGA" : "xG"}</th></tr></thead><tbody>${rows.map((r) => `<tr class="${ownedTeams.has(r.t.id) ? "owned" : ""}"><td class="club">${esc(r.t.short)}</td>${r.cells.map((cs) => `<td>${cs.length ? cs.map((f) => {
      const v = val(f);
      return `<span class="fx ${rClass(v)} ${st.target && v < 7.5 ? "dim" : ""}" data-tip="${esc(`${S.teams.get(f.opp)?.name} (${f.home ? "H" : "A"}) · xG ${fmt(f.lamFor, 2)} · xGA ${fmt(f.lamAg, 2)} · CS ${pct(f.cs * 100)} · FDR ${f.fdr} · ${f.src}`)}">${f.home ? teamShort(f.opp).toUpperCase() : teamShort(f.opp).toLowerCase()} ${fmt(v, 0)}</span>`;
    }).join(" ") : `<span class="fx blank">–</span>`}</td>`).join("")}<td class="n"><b>${fmt(r.avg, 1)}</b></td><td class="n">${fmt(r.xg, 1)}</td></tr>`).join("")}</tbody></table>`;
    const all = [...S.teams.values()].map((t) => {
      const fx = gws.flatMap((g) => S.fxByTeam.get(t.id)?.get(g) || []);
      return { t, atk: sum(fx.map((f) => f.lamFor)), cs: sum(fx.map((f) => f.cs)), fdr: fx.length ? sum(fx.map((f) => f.fdr || 3)) / fx.length : 5 };
    });
    const line = (r, v) => `<li><span class="l">${esc(r.t.name)}</span><span class="r">${v}</span></li>`;
    runs.innerHTML = "";
    runs.append(card("Best runs", `Most expected goals for over ${st.n} GW, with FPL's own difficulty for comparison.`,
      `<ul class="plist">${all.sort((a, b) => b.atk - a.atk).slice(0, 5).map((r) => line(r, `${fmt(r.atk, 1)} xG · FDR ${fmt(r.fdr, 1)}`)).join("")}</ul>`));
    runs.append(card("Worst runs", "Fewest expected goals for and fewest expected clean sheets.",
      `<ul class="plist">${all.sort((a, b) => (a.atk + a.cs) - (b.atk + b.cs)).slice(0, 5).map((r) => line(r, `${fmt(r.atk, 1)} xG · ${fmt(r.cs, 1)} CS`)).join("")}</ul>`));
  }
  ctl.addEventListener("click", (e) => {
    const b = e.target.closest(".seg button");
    if (!b) return;
    const seg = b.parentElement;
    seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    st[seg.dataset.k] = seg.dataset.k === "n" ? +b.dataset.v : b.dataset.v;
    draw();
  });
  ctl.addEventListener("change", (e) => { st[e.target.dataset.k] = e.target.checked; draw(); });
  draw();
  return wrap;
}
