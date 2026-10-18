"""Predicted line-ups from two independent sources.

Fantasy Football Scout's team-news page: each predicted starter is drawn with
a photo whose file name is the id FPL exposes as element["photo"], so the join
is on a number. The club heading the photo sits under is checked against the
player's current FPL club, so a player who moved since FFS last edited the
page does not join under his old club.

Rotowire's line-ups page: names plus a club abbreviation per match, joined by
name inside the club. It also lists injury flags (QUES/OUT).

Either source returning too few starters means its markup changed; then it
reports nothing rather than marking everyone benched."""

import re

from .. import net
from .clubs import ClubMatcher
from .names import PlayerMatcher

FFS_URL = "https://www.fantasyfootballscout.co.uk/team-news"
ROTO_URL = "https://www.rotowire.com/soccer/lineups.php"
MIN_STARTERS = 150


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
        club = clubs.match(club_name)
        if club is None:
            unmatched.add(club_name)
            continue
        for pid in re.findall(r"players/\d+x\d+/p?(\d+)\.png", block):
            e = by_photo.get(pid)
            if e and e["team"] == club:
                starters[e["id"]] = True
    if len(starters) < MIN_STARTERS:
        raise ValueError(f"only {len(starters)} starters parsed; markup probably changed")
    note = f"{len(starters)} predicted starters"
    if unmatched:
        note += f"; unmatched headings: {', '.join(sorted(unmatched))[:120]}"
    return starters, note


def rotowire(elements, teams, html):
    clubs = ClubMatcher(teams)
    players = PlayerMatcher(elements)
    starters, flags, missed = {}, {}, 0
    for box in html.split('class="lineup__box"')[1:]:
        abbrs = re.findall(r'class="lineup__abbr">\s*([A-Z]{2,4})\s*<', box)
        if len(abbrs) < 2:
            continue
        for side, abbr in (("is-home", abbrs[0]), ("is-visit", abbrs[1])):
            m = re.search(r'<ul class="lineup__list %s">(.*?)</ul>' % side, box, re.S)
            team = clubs.match(abbr)
            if not m or team is None:
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
    if len(starters) < MIN_STARTERS:
        raise ValueError(f"only {len(starters)} starters parsed; markup probably changed")
    return {"starters": starters, "flags": flags}, f"{len(starters)} predicted starters, {missed} names unmatched"


def rotowire_live(elements, teams):
    return rotowire(elements, teams, net.get_text(ROTO_URL, ttl=1800))
