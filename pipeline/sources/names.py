"""Player-name matching for sources without a shared id.

Matching is always done inside one club, which shrinks the candidate set to
~30 and makes a wrong join far less likely than a league-wide name search."""

import difflib
import re
import unicodedata


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z ]", " ", s.lower().replace("-", " ")).split()


class PlayerMatcher:
    def __init__(self, elements):
        self.by_team = {}
        for e in elements:
            full = norm(f"{e['first_name']} {e['second_name']}")
            web = norm(e["web_name"])
            self.by_team.setdefault(e["team"], []).append((e["id"], full, web))

    def match(self, team_id, name, floor=0.78):
        toks = norm(name)
        if not toks or team_id not in self.by_team:
            return None
        cands = self.by_team[team_id]
        joined = " ".join(toks)
        # 1. exact full or web name
        for pid, full, web in cands:
            if toks == full or toks == web or joined == " ".join(full):
                return pid
        # 2. "J. Pickford" style: initial + surname
        if len(toks) >= 2 and len(toks[0]) == 1:
            init, last = toks[0], toks[-1]
            hits = [pid for pid, full, web in cands
                    if full and full[-1] == last and full[0].startswith(init)]
            if len(hits) == 1:
                return hits[0]
        # 3. surname alone, if unique in the club
        last = toks[-1]
        hits = [pid for pid, full, web in cands if (full and full[-1] == last) or web == [last]]
        if len(hits) == 1:
            return hits[0]
        # 4. similarity on the whole name
        best, best_id = 0.0, None
        for pid, full, web in cands:
            for cand in (full, web):
                r = difflib.SequenceMatcher(None, joined, " ".join(cand)).ratio()
                if r > best:
                    best, best_id = r, pid
        return best_id if best >= floor else None
