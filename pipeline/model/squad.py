"""Squad building for the benchmark's "XI points" metric.

Mirrors public/js/opt.js: the best legal XI from a squad by greedy fill under
per-position bounds, and a £100m squad found by climbing from the cheapest
legal fifteen with best single swaps."""

SELECT = {1: 2, 2: 5, 3: 5, 4: 3}
PLAY = {1: (1, 1), 2: (3, 5), 3: (2, 5), 4: (1, 3)}


def best_xi(squad, val):
    by = {k: sorted([p for p in squad if p["pos"] == k], key=val, reverse=True) for k in PLAY}
    xi, count = [], {k: 0 for k in PLAY}
    for k, (lo, _hi) in PLAY.items():
        for p in by[k][:lo]:
            xi.append(p)
            count[k] += 1
    rest = sorted([p for p in squad if p not in xi and p["pos"] != 1], key=val, reverse=True)
    for p in rest:
        if len(xi) >= 11:
            break
        if count[p["pos"]] < PLAY[p["pos"]][1]:
            xi.append(p)
            count[p["pos"]] += 1
    cap = max(xi, key=val) if xi else None
    return xi, cap


def xi_score(squad, val):
    xi, cap = best_xi(squad, val)
    return sum(val(p) for p in xi) + (val(cap) if cap else 0)


def build_squad(players, val, budget, team_limit=3, pool_n=30, iters=150):
    """players: [{id, pos, team, price}]; returns the squad list."""
    pool = {}
    for k in SELECT:
        cands = [p for p in players if p["pos"] == k]
        top = sorted(cands, key=val, reverse=True)[:pool_n]
        cheap = sorted(cands, key=lambda p: (p["price"], -val(p)))[:8]
        pool[k] = top + [c for c in cheap if c not in top]
    squad, teams = [], {}
    for k, need in SELECT.items():
        for p in sorted(pool[k], key=lambda p: (p["price"], -val(p))):
            if sum(1 for q in squad if q["pos"] == k) >= need:
                break
            if teams.get(p["team"], 0) >= team_limit:
                continue
            squad.append(p)
            teams[p["team"]] = teams.get(p["team"], 0) + 1
    cost = sum(p["price"] for p in squad)
    if cost > budget or len(squad) < 15:
        return None
    score = xi_score(squad, val) + 0.1 * sum(val(p) for p in squad)
    for _ in range(iters):
        best = None
        teams = {}
        for p in squad:
            teams[p["team"]] = teams.get(p["team"], 0) + 1
        ids = {p["id"] for p in squad}
        for out in squad:
            for inn in pool[out["pos"]]:
                if inn["id"] in ids or cost - out["price"] + inn["price"] > budget + 1e-9:
                    continue
                if inn["team"] != out["team"] and teams.get(inn["team"], 0) >= team_limit:
                    continue
                nxt = [inn if q is out else q for q in squad]
                s = xi_score(nxt, val) + 0.1 * sum(val(q) for q in nxt)
                if s > score + 1e-9 and (best is None or s > best[0]):
                    best = (s, nxt, inn["price"] - out["price"])
        if best is None:
            break
        score, squad, d = best
        cost += d
    return squad
