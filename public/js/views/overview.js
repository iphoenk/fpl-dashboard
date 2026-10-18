import { S, POS, el, esc, fmt, money, pct, signed, teamShort, card, table, fixtureChip, statusLabel, startState, pname, xpSum, sum } from "../lib.js";
import { bestXI, gwVal } from "../opt.js";
import { bars } from "../charts.js";
import { openPlayer } from "../player.js";

export function renderWelcome(root, msg) {
  root.innerHTML = "";
  const top = S.players.slice().sort((a, b) => b.xp[0] - a.xp[0]).slice(0, 10);
  root.append(el(`<div class="welcome">
    <h1>Load a team to begin</h1>
    <p class="muted">Type an FPL team ID in the box above. It is the number in the address when you open "Points" on the FPL site: fantasy.premierleague.com/entry/<b>1234567</b>/event/…</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  </div>`));
  const c = card(`Top projections for GW${S.meta.next_gw}`, "League-wide, before any team is loaded. Market and Scout work without a team too.");
  c.append(table(top, [
    { k: "n", label: "Player", get: (p) => p.n, fmt: (v, p) => pname(p) },
    { k: "c", label: "Price", get: (p) => p.c, n: true, fmt: (v) => money(v) },
    { k: "fx", label: "Next", get: () => null, nosort: true, fmt: (v, p) => fixtureChip(p, S.meta.next_gw) },
    { k: "xp", label: "xP", get: (p) => p.xp[0], n: true, fmt: (v) => `<b>${fmt(v, 2)}</b>` },
  ], { id: (p) => p.id, onClick: openPlayer }));
  root.append(c);
}

function pitchCard(p, opts) {
  const s = startState(p);
  return `<div class="pcard ${s.label === "Out" ? "out" : ""}" data-id="${p.id}" title="${esc(p.fn)}: ${s.label} to start">
    ${opts.cap ? `<span class="cap">${opts.cap}</span>` : ""}
    <span class="dot stdot ${s.cls}"></span>
    <div class="nm">${esc(p.n)}</div>
    <div class="tm">${teamShort(p.t)} · ${money(p.c)}</div>
    <div class="xp">${fmt(p.xp[0], 1)}</div>
    <div class="meta">${p.pts} pts · ${fmt(p.ppg, 1)} ppg · xGI ${fmt(p.xgi, 1)}</div>
    ${fixtureChip(p, S.meta.next_gw)}
  </div>`;
}

export function renderOverview(root) {
  const T = S.team;
  root.innerHTML = "";
  const nextGw = S.meta.next_gw;
  const eh = T.picks.entry_history || {};
  const best = bestXI(T.squad, gwVal(0));
  const ev = S.meta.events.find((e) => e.id === T.gw);
  const flagged = T.squad.filter((p) => startState(p).label !== "Likely");
  const pickedXI = T.picked.filter((x) => x.pk.position <= 11).map((x) => x.p);
  const curFixturesLeft = (p) => S.fx.future.filter((f) => f.gw === T.gw && (f.h === p.t || f.a === p.t)).length;
  const stillToPlay = S.meta.current_finished ? 0 : pickedXI.filter((p) => curFixturesLeft(p) > 0).length;
  const lg = T.leagues.find((l) => l.id === S.leagueId)
    || (S.leagueId ? { name: `League ${S.leagueId}`, entry_rank: S.league?.id === S.leagueId ? S.league.managers.find((m) => m.row.entry === T.id)?.row.rank : null } : null);

  root.append(el(`<div class="hero"><h1>${esc(T.entry.name)}</h1><div class="who">${esc(T.entry.player_first_name)} ${esc(T.entry.player_last_name)} · team ${T.id}</div></div>`));
  const stats = [
    [`GW${T.gw} points`, eh.points ?? "–", ev?.avg ? `average ${ev.avg}` : ""],
    ["Total", T.entry.summary_overall_points ?? "–", ""],
    ["Overall rank", (T.entry.summary_overall_rank ?? 0).toLocaleString(), ""],
    ["League", lg ? `${lg.entry_rank ?? "–"}` : "–", lg ? `${esc(lg.name).slice(0, 22)} · <a href="#league" data-goto="league">change</a>` : ""],
    [`Projected GW${nextGw}`, fmt(best.points, 1), "best XI, captain doubled"],
    ["Bank", money(T.bank), `squad ${money(T.value)}`],
    ["Free transfers", T.ft, "estimated"],
    ["Needs a look", flagged.length, flagged.length ? flagged.map((p) => esc(p.n)).slice(0, 3).join(", ") : "all likely starters"],
    ["Still to play", stillToPlay, S.meta.current_finished ? `GW${T.gw} done` : `of your GW${T.gw} XI`],
  ];
  root.append(el(`<div class="summary">${stats.map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("")}</div>`));

  // ---- pitch + projected points
  const g = el(`<div class="grid g2"></div>`);
  const rows = [1, 2, 3, 4].map((pos) => best.xi.filter((p) => p.p === pos));
  const pitch = card(`Best XI for GW${nextGw}`, "Picked from your 15 by projected points. Dot = likelihood to start (green likely, amber doubt, red unlikely); fixture shaded by the matchup that matters for the position.");
  const pitchEl = el(`<div class="pitch">${rows.map((r) => `<div class="row">${r.map((p) => pitchCard(p, { cap: p === best.captain ? "C" : p === best.vice ? "V" : "" })).join("")}</div>`).join("")}
    <div class="bench"><div class="lbl">BENCH</div><div class="row">${best.bench.map((p) => pitchCard(p, {})).join("")}</div></div></div>`);
  pitchEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-tip]")) return;
    const c = e.target.closest(".pcard"); if (c) openPlayer(c.dataset.id);
  });
  pitch.append(pitchEl);
  // Differences against the current picks
  const curIds = new Set(pickedXI.map((p) => p.id));
  const ins = best.xi.filter((p) => !curIds.has(p.id)), outs = pickedXI.filter((p) => !best.xi.includes(p));
  const curCap = T.picked.find((x) => x.pk.is_captain)?.p;
  const notes = [];
  if (ins.length) notes.push(`Start ${ins.map((p) => esc(p.n)).join(", ")} over ${outs.map((p) => esc(p.n)).join(", ")}.`);
  if (curCap && best.captain && curCap.id !== best.captain.id) notes.push(`Captain ${esc(best.captain.n)} (${fmt(best.captain.xp[0], 1)}) rather than ${esc(curCap.n)} (${fmt(curCap.xp[0], 1)}).`);
  if (notes.length) pitch.append(el(`<p class="note">Compared with your GW${T.gw} line-up: ${notes.join(" ")}</p>`));
  g.append(pitch);

  const proj = card(`Projected points, GW${nextGw}`, `${fmt(best.points, 1)} for the XI with ${esc(best.captain?.n ?? "")} captained; bench ${fmt(best.benchPoints, 1)}.`);
  proj.append(bars([...best.xi].sort((a, b) => b.xp[0] - a.xp[0]).map((p) => ({
    label: `${esc(p.n)}${p === best.captain ? " (C)" : ""}`, v: p.xp[0] * (p === best.captain ? 2 : 1),
    text: fmt(p.xp[0] * (p === best.captain ? 2 : 1), 1), title: `${p.fn}: ${fmt(p.xp[0], 2)} xP`,
  }))));
  proj.append(el(`<h3>Next ${S.horizon} gameweeks</h3>`));
  const hz = [];
  for (let k = 0; k < S.horizon; k++) hz.push({ gw: nextGw + k, pts: bestXI(T.squad, gwVal(k)).points });
  proj.append(bars(hz.map((h) => ({ label: `GW${h.gw}`, v: h.pts, text: fmt(h.pts, 1), cls: "alt" }))));
  g.append(proj);
  root.append(g);

  // ---- squad detail
  root.append(el(`<div class="section-title">Squad detail</div>`));
  const sq = card("Your fifteen", "Season numbers and projections. Click a row for the player's full page.");
  sq.append(table(T.squad, [
    { k: "n", label: "Player", get: (p) => p.n, fmt: (v, p) => pname(p) },
    { k: "st", label: "Start", get: (p) => p.nx?.pstart, n: true, fmt: (v, p) => statusLabel(p) },
    { k: "c", label: "Price", get: (p) => p.c, n: true, fmt: (v) => money(v) },
    { k: "pts", label: "Pts", get: (p) => p.pts, n: true },
    { k: "min", label: "Min", get: (p) => p.min, n: true },
    { k: "g", label: "G", get: (p) => p.g, n: true },
    { k: "a", label: "A", get: (p) => p.a, n: true },
    { k: "xg", label: "xG", get: (p) => p.xg, n: true, fmt: (v) => fmt(v, 2) },
    { k: "xa", label: "xA", get: (p) => p.xa, n: true, fmt: (v) => fmt(v, 2) },
    { k: "cs", label: "CS", get: (p) => p.cs, n: true },
    { k: "sv", label: "Sv", get: (p) => p.sv, n: true },
    { k: "b", label: "Bonus", get: (p) => p.b, n: true },
    { k: "dcp", label: "DefCon pts", get: (p) => p.dcp, n: true },
    { k: "sel", label: "Own", get: (p) => p.sel, n: true, fmt: (v) => pct(v, 1) },
    { k: "xp0", label: `xP ${nextGw}`, get: (p) => p.xp[0], n: true, fmt: (v) => `<b>${fmt(v, 1)}</b>` },
    { k: "xp5", label: `xP ${S.horizon}GW`, get: (p) => xpSum(p), n: true, fmt: (v) => fmt(v, 1) },
  ], { sort: "xp5", id: (p) => p.id, onClick: openPlayer }));
  root.append(sq);

  const fxc = card(`Fixtures, next ${S.horizon}`, "Rated 1–10 within this window: attackers by expected goals for, defenders and keepers by clean-sheet chance. Capitals = home.");
  const gws = Array.from({ length: S.horizon }, (_, i) => nextGw + i);
  fxc.append(table(T.squad, [
    { k: "n", label: "Player", get: (p) => p.n, fmt: (v, p) => pname(p) },
    ...gws.map((g2, i) => ({ k: `g${g2}`, label: `GW${g2}`, get: (p) => p.xp[i], n: true, fmt: (v, p) => `${fixtureChip(p, g2)} <span class="small">${fmt(v, 1)}</span>` })),
  ], { sort: `g${nextGw}`, id: (p) => p.id, onClick: openPlayer }));
  root.append(fxc);

  // ---- what the numbers say
  root.append(el(`<div class="section-title">What the numbers say</div>`));
  const w = el(`<div class="grid g3"></div>`);
  const attackers = T.squad.filter((p) => p.p >= 3 || p.xg > 0.5);

  const owed = attackers.map((p) => ({ p, d: p.g - p.xg })).sort((a, b) => a.d - b.d);
  w.append(card("Goals against xG", "Below zero: scoring less than chances suggest (owed). Above: running hot, likely to cool.",
    bars(owed.map(({ p, d }) => ({ label: esc(p.n), v: d, text: signed(d, 1), cls: d < 0 ? "" : "neg", title: `${p.g} goals from ${fmt(p.xg, 2)} xG` })))));

  const defs = T.squad.filter((p) => p.p >= 2 && p.min > 0).sort((a, b) => (b.r?.dc_hit ?? 0) - (a.r?.dc_hit ?? 0));
  w.append(card("Defensive contribution", `Share of 60-minute games reaching the threshold (DEF ${S.meta.defcon_thresholds.DEF}, MID/FWD ${S.meta.defcon_thresholds.MID}). Points so far in brackets.`,
    bars(defs.map((p) => ({ label: esc(p.n), v: (p.r?.dc_hit ?? 0) * 100, text: `${fmt((p.r?.dc_hit ?? 0) * 100, 0)}% (${p.dcp})`, max: 100 })), { max: 100 })));

  const sp = T.squad.filter((p) => p.pen || p.cor || p.dfk);
  w.append(card("Set pieces", "Order the club lists, from FPL. 1 = first choice.",
    sp.length ? `<ul class="plist">${sp.map((p) => `<li><span class="l">${pname(p)}</span><span class="r small">${[p.pen && `pens ${p.pen}`, p.cor && `corners ${p.cor}`, p.dfk && `FKs ${p.dfk}`].filter(Boolean).join(" · ")}</span></li>`).join("")}</ul>` : `<p class="faint">Nobody in your squad is listed on set pieces.</p>`));

  const price = T.squad.filter((p) => p.pcp != null).sort((a, b) => Math.abs(b.pcp) - Math.abs(a.pcp)).slice(0, 8);
  w.append(card("Price watch", "FPL's own progress toward a price change (±100 = change tonight). Season change in brackets.",
    bars(price.map((p) => ({ label: esc(p.n), v: p.pcp, text: `${signed(p.pcp, 0)} (${signed(p.ccs / 10, 1)})`, cls: p.pcp < 0 ? "neg" : "", title: `transfers in ${p.tin.toLocaleString()}, out ${p.tout.toLocaleString()} this GW` })), { max: 100 })));

  const risk = T.squad.slice().sort((a, b) => (a.nx?.pstart ?? 0) - (b.nx?.pstart ?? 0)).slice(0, 8);
  w.append(card("Minutes risk", "Projected chance to start next gameweek, from recent starts, FPL availability and both predicted line-ups.",
    `<ul class="plist">${risk.map((p) => `<li><span class="l">${pname(p)}</span><span class="r">${statusLabel(p)}</span></li>`).join("")}</ul>`));

  const bc = attackers.filter((p) => p.op).sort((a, b) => ((b.op.bcc || 0) + (b.op.bcm || 0)) - ((a.op.bcc || 0) + (a.op.bcm || 0)));
  w.append(card("Big chances (Opta)", "Created and missed this season: volume that FPL's own stats do not show.",
    bc.length ? bars(bc.map((p) => ({ label: esc(p.n), v: (p.op.bcc || 0) + (p.op.bcm || 0), text: `${p.op.bcc || 0} / ${p.op.bcm || 0}`, title: "created / missed" }))) : `<p class="faint">Opta feed unavailable this build.</p>`));

  const agree = T.squad.filter((p) => p.lu && (p.lu.ffs != null || p.lu.rotowire != null));
  const dis = agree.filter((p) => p.lu.ffs != null && p.lu.rotowire != null && p.lu.ffs !== p.lu.rotowire);
  w.append(card("Line-up sources", `${S.meta.lineup_sources.join(" + ") || "none this build"}. Disagreements are where the minutes risk lives.`,
    dis.length ? `<ul class="plist">${dis.map((p) => `<li><span class="l">${pname(p)}</span><span class="r small">FFS ${p.lu.ffs ? "start" : "bench"} · Roto ${p.lu.rotowire ? "start" : "bench"}</span></li>`).join("")}</ul>`
      : `<p class="faint">${agree.length ? "Both sources agree on every covered player in your squad." : "No line-up source covered your squad this build."}</p>`));

  const chall = T.squad.filter((p) => p.fl?.pred != null && p.fl.gw === nextGw).map((p) => ({ p, d: p.xp[0] - p.fl.pred })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8);
  w.append(card("Projection vs FPLens", "Where the primary projection and the challenger model disagree most for your players.",
    chall.length ? bars(chall.map(({ p, d }) => ({ label: esc(p.n), v: d, text: `${fmt(p.xp[0], 1)} vs ${fmt(p.fl.pred, 1)}`, cls: d < 0 ? "neg" : "" }))) : `<p class="faint">FPLens has no snapshot for GW${nextGw} yet.</p>`));
  root.append(w);
}
