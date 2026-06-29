import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parent
LOCAL_STORE = ROOT / "local-store.json"

TARGET_LEAGUE_ID = 19101
TARGET_TIER = "顶级赛事"


def connect():
    return pymysql.connect(
        host="47.86.96.51",
        port=9030,
        user="dota2_reader",
        password="readerDota.",
        database="dwd_dota2",
        charset="utf8mb4",
    )


def load_position_hints():
    if not LOCAL_STORE.exists():
        return {}
    db = json.loads(LOCAL_STORE.read_text(encoding="utf-8"))
    by_sid = defaultdict(list)
    for p in db.get("players", []):
        sid = p.get("steamid64")
        pos = p.get("position")
        if sid and pos:
            by_sid[str(sid)].append(int(pos))
    hints = {}
    for sid, positions in by_sid.items():
        hints[sid] = Counter(positions).most_common(1)[0][0]
    return hints


def normalize_team_name(name):
    if not name:
        return ""
    return " ".join(name.strip().split())


def team_tag_from_name(name):
    name = normalize_team_name(name)
    if len(name) <= 8:
        return name
    parts = [p for p in name.replace("-", " ").split(" ") if p]
    if len(parts) >= 2:
        tag = "".join(p[0].upper() for p in parts[:4])
        return tag[:8]
    return name[:8]


def synthetic_team_id(league_id, team_name):
    key = f"{league_id}:{team_name}".encode("utf-8")
    digest = hashlib.md5(key).hexdigest()[:12]
    return str(int(digest, 16))


def fetch_rows():
    conn = connect()
    cur = conn.cursor()
    sql = """
SELECT
  mo.league_id,
  mo.league_name,
  CASE
    WHEN mp.team = 2 THEN mo.team_name_1
    WHEN mp.team = 3 THEN mo.team_name_2
    ELSE NULL
  END AS team_name,
  mp.steamid,
  mp.name,
  mp.hits_5m
FROM dwd_match_player_positions mp
JOIN dwd_match_overview mo ON mo.match_id = mp.match_id
WHERE mo.league_id = %s
  AND mp.steamid IS NOT NULL
  AND mp.steamid <> ''
"""
    cur.execute(sql, [TARGET_LEAGUE_ID])
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def build_lineups(rows, position_hints):
    player_stats = {}
    for league_id, league_name, team_name, steamid, nickname, hits_5m in rows:
        team_name = normalize_team_name(team_name or "")
        if not team_name:
            continue
        sid = str(steamid).strip()
        if not sid:
            continue
        key = (int(league_id), str(league_name), team_name, sid)
        if key not in player_stats:
            player_stats[key] = {"count": 0, "hits": [], "names": Counter()}
        player_stats[key]["count"] += 1
        if hits_5m is not None:
            try:
                player_stats[key]["hits"].append(float(hits_5m))
            except Exception:
                pass
        if nickname:
            player_stats[key]["names"][str(nickname)] += 1

    team_map = defaultdict(list)
    for (league_id, league_name, team_name, sid), st in player_stats.items():
        avg_hits = sum(st["hits"]) / len(st["hits"]) if st["hits"] else 0.0
        best_name = st["names"].most_common(1)[0][0] if st["names"] else sid
        team_map[(league_id, league_name, team_name)].append(
            {"steamid": sid, "nickname": best_name, "count": st["count"], "avg_hits": avg_hits}
        )

    lineup_rows = []
    for (league_id, league_name, team_name), players in team_map.items():
        players_sorted = sorted(
            players, key=lambda x: (x["count"], x["avg_hits"]), reverse=True
        )[:5]
        if len(players_sorted) < 5:
            continue

        assigned = {}
        used_positions = set()
        for p in players_sorted:
            hint = position_hints.get(p["steamid"])
            if hint and hint not in used_positions:
                assigned[hint] = p
                used_positions.add(hint)

        remaining_players = [p for p in players_sorted if p not in assigned.values()]
        remaining_players.sort(key=lambda x: x["avg_hits"], reverse=True)
        remaining_positions = [pos for pos in [1, 2, 3, 4, 5] if pos not in used_positions]
        for pos, p in zip(remaining_positions, remaining_players):
            assigned[pos] = p

        if any(pos not in assigned for pos in [1, 2, 3, 4, 5]):
            continue

        lineup_rows.append(
            {
                "league_id": league_id,
                "league_name": league_name,
                "team_id": synthetic_team_id(league_id, team_name),
                "team_name": team_name,
                "team_tag": team_tag_from_name(team_name),
                "players": {pos: assigned[pos] for pos in [1, 2, 3, 4, 5]},
            }
        )

    lineup_rows.sort(key=lambda r: (r["league_id"], r["team_name"]))
    return lineup_rows


def merge_into_local_store(rows):
    db = json.loads(LOCAL_STORE.read_text(encoding="utf-8"))
    tournaments = db["tournaments"]
    teams = db["teams"]
    players = db["players"]

    next_tournament_id = max([t["id"] for t in tournaments], default=0) + 1
    next_team_id = max([t["id"] for t in teams], default=0) + 1
    next_player_id = max([p["id"] for p in players], default=0) + 1
    now = datetime.utcnow().isoformat() + "Z"

    tournament_by_league = {str(t["league_id"]): t for t in tournaments}

    for row in rows:
        league_id = str(row["league_id"])
        league_name = row["league_name"]
        tournament = tournament_by_league.get(league_id)
        if not tournament:
            tournament = {
                "id": next_tournament_id,
                "name": league_name,
                "league_id": league_id,
                "event_tier": TARGET_TIER,
                "created_at": now,
                "updated_at": now,
            }
            next_tournament_id += 1
            tournaments.append(tournament)
            tournament_by_league[league_id] = tournament
        else:
            tournament["name"] = league_name
            tournament["event_tier"] = TARGET_TIER
            tournament["updated_at"] = now

        team = next(
            (
                t
                for t in teams
                if t["tournament_id"] == tournament["id"] and t["name"] == row["team_name"]
            ),
            None,
        )
        if not team:
            team = {
                "id": next_team_id,
                "tournament_id": tournament["id"],
                "name": row["team_name"],
                "short_name": row["team_tag"] or None,
                "team_id": row["team_id"],
                "status": "完整",
                "created_at": now,
                "updated_at": now,
            }
            next_team_id += 1
            teams.append(team)
        else:
            team["short_name"] = row["team_tag"] or None
            team["team_id"] = row["team_id"]
            team["status"] = "完整"
            team["updated_at"] = now

        players[:] = [p for p in players if p["team_id"] != team["id"]]
        for pos in [1, 2, 3, 4, 5]:
            p = row["players"][pos]
            players.append(
                {
                    "id": next_player_id,
                    "team_id": team["id"],
                    "nickname": p["nickname"],
                    "steamid64": p["steamid"],
                    "position": pos,
                    "created_at": now,
                    "updated_at": now,
                }
            )
            next_player_id += 1

    db["tournaments"] = tournaments
    db["teams"] = teams
    db["players"] = players
    LOCAL_STORE.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    position_hints = load_position_hints()
    rows = fetch_rows()
    lineup_rows = build_lineups(rows, position_hints)
    merge_into_local_store(lineup_rows)
    print(f"赛事 league_id={TARGET_LEAGUE_ID} 重建战队数: {len(lineup_rows)}")
    for r in lineup_rows:
        print(f" - {r['team_name']}")
    print(f"已合并到: {LOCAL_STORE}")


if __name__ == "__main__":
    main()
