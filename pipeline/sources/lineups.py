"""Predicted line-ups from two independent sources.

Fantasy Football Scout's team-news page: each predicted starter is drawn with
a photo whose file name is the id FPL exposes as element["photo"], so the join
is on a number. The club heading the photo sits under is checked against the
player's current FPL club, so a player who moved since FFS last edited the
page does not join under his old club.

Rotowire's line-ups page: names plus a club abbreviation per match, joined by
name inside the club. It also lists injury flags (QUES/OUT).

A club counts as covered only when at least COVERED_MIN of its starters were
matched, and (for Rotowire) only when the match listed is the club's fixture
in the gameweek being projected. A page that lists half the round therefore
covers half the clubs, and a snapshot from last week covers none: in both
cases the uncovered clubs fall back to the start-rate model rather than being
marked benched."""

import re

from .. import net
from .clubs import ClubMatcher
from .names import PlayerMatcher

FFS_URL = "https://www.fantasyfootballscout.co.uk/team-news"
ROTO_URL = "https://www.rotowire.com/soccer/lineups.php"
COVERED_MIN = 9
MIN_CLUBS = 2


def _covered(starters, team_of):
    count = {}
    for pid in starters:
        t = team_of.get(pid)
        count[t] = count.get(t, 0) + 1
    return {t for t, c in count.items() if c >= COVERED_MIN}


def ffs(elements, teams):
    html = net.get_text(FFS_URL, ttl=1800)
    clubs = ClubMatcher(teams)
    by_photo = {}
    for e in elements:
        stem = str(e.get("photo") or "").split(".")[0]
        if stem:
            by_photo[stem] = e
    starters, unmatched = {}, set()
    for block in re.split(r'(?=<li class="team-news-item")', html):
        head = re.search(r"<h2[^>]*>\s*(.*?)\s*</h2>", block, re.S)
        if not head:
            continue
        club_name = re.sub(r"<[^>]+>|\s+", " ", head.group(1)).strip()
        photos = re.findall(r"players/\d+x\d+/p?(\d+)\.png", block)
        if not photos:
            continue
        club = clubs.match(club_name)
        if club is None:
            unmatched.add(club_name)
            continue
        for pid in photos:
            e = by_photo.get(pid)
            if e and e["team"] == club:
                starters[e["id"]] = True
    team_of = {e["id"]: e["team"] for e in elements}
    covered = _covered(starters, team_of)
    if len(covered) < MIN_CLUBS:
        raise ValueError(f"only {len(starters)} starters parsed across {len(covered)} clubs; markup probably changed")
    note = f"{len(starters)} predicted starters, {len(covered)} clubs covered"
    if unmatched:
        note += f"; unmatched headings: {', '.join(sorted(unmatched))[:120]}"
    return {"starters": starters, "teams": covered}, note


def rotowire(elements, teams, html, next_pairs):
    """next_pairs: {(home_id, away_id)} for the gameweek being projected."""
    clubs = ClubMatcher(teams)
    players = PlayerMatcher(elements)
    starters, flags, missed, other_round = {}, {}, 0, 0
    for box in html.split('class="lineup__box"')[1:]:
        abbrs = re.findall(r'class="lineup__abbr">\s*([A-Z]{2,4})\s*<', box)
        if len(abbrs) < 2:
            continue
        pair = (clubs.match(abbrs[0]), clubs.match(abbrs[1]))
        if pair not in next_pairs:
            other_round += 1
            continue
        for side, team in (("is-home", pair[0]), ("is-visit", pair[1])):
            m = re.search(r'<ul class="lineup__list %s">(.*?)</ul>' % side, box, re.S)
            if not m:
                continue
            body = m.group(1)
            xi_part, _, inj_part = body.partition("lineup__title")
            for name, tail in re.findall(r'<a title="([^"]+)"[^>]*>.*?</a>(.*?)</li>', xi_part, re.S):
                pid = players.match(team, name)
                if pid is None:
                    missed += 1
                    continue
                starters[pid] = True
                inj = re.search(r'lineup__inj">\s*([A-Z]+)', tail)
                if inj:
                    flags[pid] = inj.group(1)
            for name, tail in re.findall(r'<a title="([^"]+)"[^>]*>.*?</a>(.*?)</li>', inj_part, re.S):
                pid = players.match(team, name)
                inj = re.search(r'lineup__inj">\s*([A-Z]+)', tail)
                if pid is not None and inj:
                    flags[pid] = inj.group(1)
    team_of = {e["id"]: e["team"] for e in elements}
    covered = _covered(starters, team_of)
    if len(covered) < MIN_CLUBS:
        raise ValueError(f"no usable line-ups for this gameweek ({len(starters)} starters, "
                         f"{other_round} matches from another round)")
    return {"starters": starters, "flags": flags, "teams": covered}, \
        f"{len(starters)} predicted starters, {len(covered)} clubs covered, {missed} names unmatched"


def rotowire_live(elements, teams, next_pairs):
    return rotowire(elements, teams, net.get_text(ROTO_URL, ttl=1800), next_pairs)
