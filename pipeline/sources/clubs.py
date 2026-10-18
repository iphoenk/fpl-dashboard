"""Club-name matching across sources.

Every outside source spells clubs its own way. Rather than one alias table per
source, names are normalised to a canonical token string and then matched to
the FPL club with the highest similarity, with a floor below which the match
is refused (an unmatched club is reported, never guessed)."""

import difflib
import re
import unicodedata

# Word-level rewrites applied before comparison. These are spelling variants,
# not club mappings: they make "Manchester United" and "Man Utd" the same
# string, and leave every other comparison to the similarity score.
WORDS = {
    "manchester": "man", "united": "utd", "hotspur": "", "tottenham": "spurs",
    "nottingham": "nottm", "notts": "nottm", "forest": "forest",
    "wolverhampton": "wolves", "wanderers": "", "brighton": "brighton",
    "hove": "", "albion": "", "afc": "", "fc": "", "and": "", "the": "",
    "city": "city", "athletic": "", "west": "west", "ham": "ham",
}


def norm(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("'", ""))
    toks = [WORDS.get(t, t) for t in s.split()]
    return " ".join(t for t in toks if t)


class ClubMatcher:
    def __init__(self, teams):
        self.teams = teams
        self.keys = []
        for t in teams:
            for label in (t["name"], t["short_name"]):
                self.keys.append((norm(label), t["id"]))

    def match(self, name, floor=0.72):
        n = norm(name)
        if not n:
            return None
        best, best_id = 0.0, None
        for key, tid in self.keys:
            if not key:
                continue
            if n == key:
                return tid
            score = difflib.SequenceMatcher(None, n, key).ratio()
            if key in n or n in key:
                score = max(score, 0.9)
            if score > best:
                best, best_id = score, tid
        return best_id if best >= floor else None
