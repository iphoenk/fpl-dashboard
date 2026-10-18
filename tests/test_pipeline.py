"""Unit tests for the parts that run blind against outside sources.

Run: python -m unittest discover -s tests -t ."""

import math
import unittest
from unittest import mock

from pipeline.model import teams as T
from pipeline.model import xp as X
from pipeline.sources import clubs, names, pinnacle

TEAMS = [
    {"id": 1, "name": "Arsenal", "short_name": "ARS"},
    {"id": 2, "name": "Man City", "short_name": "MCI"},
    {"id": 3, "name": "Man Utd", "short_name": "MUN"},
    {"id": 4, "name": "Spurs", "short_name": "TOT"},
    {"id": 5, "name": "Nott'm Forest", "short_name": "NFO"},
    {"id": 6, "name": "Wolves", "short_name": "WOL"},
    {"id": 7, "name": "Brighton", "short_name": "BHA"},
    {"id": 8, "name": "West Ham", "short_name": "WHU"},
    {"id": 9, "name": "Bournemouth", "short_name": "BOU"},
]


class ClubMatching(unittest.TestCase):
    def test_bookmaker_spellings(self):
        m = clubs.ClubMatcher(TEAMS)
        cases = {
            "Manchester City": 2, "Manchester United": 3, "Tottenham Hotspur": 4,
            "Nottingham Forest": 5, "Wolverhampton Wanderers": 6, "Brighton and Hove Albion": 7,
            "West Ham United": 8, "AFC Bournemouth": 9, "Arsenal": 1, "MCI": 2,
        }
        for name, tid in cases.items():
            self.assertEqual(m.match(name), tid, name)

    def test_refuses_unknown(self):
        self.assertIsNone(clubs.ClubMatcher(TEAMS).match("Real Madrid"))


class NameMatching(unittest.TestCase):
    ELS = [
        {"id": 10, "team": 1, "first_name": "Bukayo", "second_name": "Saka", "web_name": "Saka"},
        {"id": 11, "team": 1, "first_name": "Martin", "second_name": "Ødegaard", "web_name": "Ødegaard"},
        {"id": 12, "team": 2, "first_name": "Erling", "second_name": "Haaland", "web_name": "Haaland"},
        {"id": 13, "team": 1, "first_name": "Ben", "second_name": "White", "web_name": "White"},
        {"id": 14, "team": 1, "first_name": "Kai", "second_name": "Havertz", "web_name": "Havertz"},
    ]

    def test_variants(self):
        m = names.PlayerMatcher(self.ELS)
        self.assertEqual(m.match(1, "B. Saka"), 10)
        self.assertEqual(m.match(1, "Martin Odegaard"), 11)
        self.assertEqual(m.match(2, "Erling Haaland"), 12)
        self.assertIsNone(m.match(2, "B. Saka"))  # never across clubs


class Pinnacle(unittest.TestCase):
    def test_even_money_interpolation(self):
        ladder = [(2.5, 0.55), (2.75, 0.47), (3.0, 0.40)]
        line = pinnacle.even_money_point(ladder)
        self.assertTrue(2.5 < line < 2.75)

    def test_fetch_builds_lambdas(self):
        def am(p):  # fair probability -> american odds, with a small margin
            q = min(0.97, p * 1.025)
            return round(-100 * q / (1 - q)) if q >= 0.5 else round(100 * (1 - q) / q)
        matchups = [{"id": 1, "participants": [{"alignment": "home", "name": "Arsenal"}, {"alignment": "away", "name": "Manchester City"}], "startTime": "2026-10-24T14:00:00Z"}]
        markets = [
            {"matchupId": 1, "period": 0, "type": "total", "prices": [{"designation": "over", "points": 2.5, "price": am(0.58)}, {"designation": "under", "points": 2.5, "price": am(0.42)}]},
            {"matchupId": 1, "period": 0, "type": "total", "prices": [{"designation": "over", "points": 3.0, "price": am(0.40)}, {"designation": "under", "points": 3.0, "price": am(0.60)}]},
            {"matchupId": 1, "period": 0, "type": "spread", "prices": [{"designation": "home", "points": -0.25, "price": am(0.52)}, {"designation": "away", "points": 0.25, "price": am(0.48)}]},
            {"matchupId": 1, "period": 0, "type": "spread", "prices": [{"designation": "home", "points": -0.5, "price": am(0.45)}, {"designation": "away", "points": 0.5, "price": am(0.55)}]},
            {"matchupId": 1, "period": 0, "type": "moneyline", "prices": [{"designation": "home", "price": 150}, {"designation": "draw", "price": 250}, {"designation": "away", "price": 180}]},
        ]
        with mock.patch.object(pinnacle.net, "get_json", side_effect=[matchups, markets]):
            out, note = pinnacle.fetch(TEAMS)
        self.assertEqual(len(out), 1)
        g = out[0]
        self.assertEqual((g["team_h"], g["team_a"]), (1, 2))
        self.assertTrue(2.5 < g["total"] < 3.0)
        self.assertTrue(0.25 < g["supremacy"] < 0.5)
        self.assertAlmostEqual(g["lam_h"] + g["lam_a"], g["total"], places=2)
        self.assertAlmostEqual(sum(g["result"].values()), 1.0, places=3)


class Model(unittest.TestCase):
    def test_floor_div_matches_simulation_limit(self):
        # E[floor(X/2)] for Poisson(1.5) by direct sum
        lam = 1.5
        direct = sum((k // 2) * math.exp(-lam) * lam ** k / math.factorial(k) for k in range(40))
        self.assertAlmostEqual(T.poisson_floor_div(lam, 2), direct, places=6)

    def test_spearman(self):
        self.assertAlmostEqual(X.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(X.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)

    def test_availability(self):
        cfg = {"injury_recovery_per_gw": 0.25, "suspension_recovery_per_gw": 0.5}
        self.assertEqual(X.availability({"status": "a", "chance_of_playing_next_round": None}, 0, cfg), 1.0)
        self.assertEqual(X.availability({"status": "i", "chance_of_playing_next_round": 0}, 0, cfg), 0.0)
        self.assertEqual(X.availability({"status": "i", "chance_of_playing_next_round": 0}, 2, cfg), 0.5)
        self.assertEqual(X.availability({"status": "u", "chance_of_playing_next_round": None}, 5, cfg), 0.0)


if __name__ == "__main__":
    unittest.main()
