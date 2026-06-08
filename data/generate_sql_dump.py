import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
SOURCE_JSON = BASE_DIR / "local-store.json"
DDL_SQL = BASE_DIR / "lineup_schema.sql"
DATA_SQL = BASE_DIR / "lineup_current_data.sql"


def esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "''")


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return f"'{esc(str(value))}'"


def write_ddl():
    ddl = """-- Recommended normalized schema for lineup management
-- Generated from local-store structure

CREATE TABLE IF NOT EXISTS dim_tournament (
  id BIGINT PRIMARY KEY COMMENT '比赛主键ID',
  league_id VARCHAR(64) NOT NULL UNIQUE COMMENT '外部联赛ID',
  league_name VARCHAR(255) NOT NULL COMMENT '联赛名称',
  created_at DATETIME NOT NULL COMMENT '创建时间',
  updated_at DATETIME NOT NULL COMMENT '更新时间'
) COMMENT='比赛维度表';

CREATE TABLE IF NOT EXISTS dim_team (
  id BIGINT PRIMARY KEY COMMENT '战队主键ID',
  team_ext_id VARCHAR(64) NULL COMMENT '外部战队ID',
  team_name VARCHAR(255) NOT NULL COMMENT '战队全称',
  team_tag VARCHAR(64) NULL COMMENT '战队简称',
  created_at DATETIME NOT NULL COMMENT '创建时间',
  updated_at DATETIME NOT NULL COMMENT '更新时间'
) COMMENT='战队维度表';

CREATE TABLE IF NOT EXISTS dim_player (
  id BIGINT PRIMARY KEY COMMENT '选手主键ID',
  steamid64 VARCHAR(32) NOT NULL UNIQUE COMMENT 'SteamID64（全局唯一）',
  current_nickname VARCHAR(255) NOT NULL COMMENT '当前昵称',
  created_at DATETIME NOT NULL COMMENT '创建时间',
  updated_at DATETIME NOT NULL COMMENT '更新时间'
) COMMENT='选手维度表';

CREATE TABLE IF NOT EXISTS tournament_team (
  id BIGINT PRIMARY KEY COMMENT '赛事-战队关系主键ID',
  tournament_id BIGINT NOT NULL COMMENT '比赛ID（关联 dim_tournament.id）',
  team_id BIGINT NOT NULL COMMENT '战队ID（关联 dim_team.id）',
  team_name_snapshot VARCHAR(255) NULL COMMENT '赛事中的战队名快照',
  team_tag_snapshot VARCHAR(64) NULL COMMENT '赛事中的战队简称快照',
  status VARCHAR(32) NOT NULL COMMENT '阵容状态（完整/缺失/重复/待确认）',
  created_at DATETIME NOT NULL COMMENT '创建时间',
  updated_at DATETIME NOT NULL COMMENT '更新时间',
  UNIQUE KEY uq_tournament_team (tournament_id, team_id)
) COMMENT='赛事与战队关系表';

CREATE TABLE IF NOT EXISTS lineup_current (
  tournament_team_id BIGINT NOT NULL COMMENT '赛事-战队关系ID（关联 tournament_team.id）',
  position TINYINT NOT NULL COMMENT '分路位置（1~5）',
  player_id BIGINT NOT NULL COMMENT '选手ID（关联 dim_player.id）',
  nickname_snapshot VARCHAR(255) NOT NULL COMMENT '该赛事下昵称快照',
  steamid64_snapshot VARCHAR(32) NOT NULL COMMENT '该赛事下 SteamID64 快照',
  updated_at DATETIME NOT NULL COMMENT '最近更新时间',
  PRIMARY KEY (tournament_team_id, position),
  UNIQUE KEY uq_lineup_player (tournament_team_id, player_id)
) COMMENT='当前阵容表（每队每个位置一条）';

CREATE TABLE IF NOT EXISTS lineup_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '历史变更主键ID',
  tournament_team_id BIGINT NOT NULL COMMENT '赛事-战队关系ID',
  position TINYINT NOT NULL COMMENT '分路位置（1~5）',
  old_player_id BIGINT NULL COMMENT '变更前选手ID',
  new_player_id BIGINT NOT NULL COMMENT '变更后选手ID',
  old_nickname VARCHAR(255) NULL COMMENT '变更前昵称',
  new_nickname VARCHAR(255) NOT NULL COMMENT '变更后昵称',
  changed_at DATETIME NOT NULL COMMENT '变更时间',
  changed_by VARCHAR(128) NULL COMMENT '操作人',
  change_reason VARCHAR(255) NULL COMMENT '变更原因'
) COMMENT='阵容历史变更表';
"""
    DDL_SQL.write_text(ddl, encoding="utf-8")


def write_data():
    raw = json.loads(SOURCE_JSON.read_text(encoding="utf-8"))
    tournaments = raw.get("tournaments", [])
    teams = raw.get("teams", [])
    players = raw.get("players", [])

    player_by_team = {}
    for p in players:
        player_by_team.setdefault(p["team_id"], []).append(p)
    for tid in player_by_team:
        player_by_team[tid] = sorted(player_by_team[tid], key=lambda x: x["position"])

    lines = []
    lines.append("-- 当前数据快照（由 data/local-store.json 生成）")
    lines.append("-- 注意：该脚本默认先清空目标表，再全量写入")
    lines.append("START TRANSACTION;")
    lines.append("")

    # cleanup sequence for re-import
    lines.append("DELETE FROM lineup_current;")
    lines.append("DELETE FROM tournament_team;")
    lines.append("DELETE FROM dim_player;")
    lines.append("DELETE FROM dim_team;")
    lines.append("DELETE FROM dim_tournament;")
    lines.append("")

    if tournaments:
        vals = []
        for t in tournaments:
            vals.append(
                "("
                + ",".join(
                    [
                        sql_value(t["id"]),
                        sql_value(t["league_id"]),
                        sql_value(t["name"]),
                        sql_value(t["created_at"]),
                        sql_value(t["updated_at"]),
                    ]
                )
                + ")"
            )
        lines.append(
            "INSERT INTO dim_tournament (id, league_id, league_name, created_at, updated_at) VALUES\n"
            + ",\n".join(vals)
            + ";"
        )
        lines.append("")

    if teams:
        vals = []
        for t in teams:
            vals.append(
                "("
                + ",".join(
                    [
                        sql_value(t["id"]),
                        sql_value(t.get("team_id")),
                        sql_value(t["name"]),
                        sql_value(t.get("short_name")),
                        sql_value(t["created_at"]),
                        sql_value(t["updated_at"]),
                    ]
                )
                + ")"
            )
        lines.append(
            "INSERT INTO dim_team (id, team_ext_id, team_name, team_tag, created_at, updated_at) VALUES\n"
            + ",\n".join(vals)
            + ";"
        )
        lines.append("")

    # dim_player dedupe by steamid64
    seen_steam = {}
    for p in players:
        sid = p.get("steamid64")
        if not sid:
            continue
        seen_steam[sid] = p

    dim_players = sorted(seen_steam.values(), key=lambda x: x["id"])
    if dim_players:
        vals = []
        for p in dim_players:
            vals.append(
                "("
                + ",".join(
                    [
                        sql_value(p["id"]),
                        sql_value(p["steamid64"]),
                        sql_value(p["nickname"]),
                        sql_value(p["created_at"]),
                        sql_value(p["updated_at"]),
                    ]
                )
                + ")"
            )
        lines.append(
            "INSERT INTO dim_player (id, steamid64, current_nickname, created_at, updated_at) VALUES\n"
            + ",\n".join(vals)
            + ";"
        )
        lines.append("")

    if teams:
        vals = []
        for t in teams:
            vals.append(
                "("
                + ",".join(
                    [
                        sql_value(t["id"]),
                        sql_value(t["tournament_id"]),
                        sql_value(t["id"]),
                        sql_value(t["name"]),
                        sql_value(t.get("short_name")),
                        sql_value(t.get("status", "缺失")),
                        sql_value(t["created_at"]),
                        sql_value(t["updated_at"]),
                    ]
                )
                + ")"
            )
        lines.append(
            "INSERT INTO tournament_team (id, tournament_id, team_id, team_name_snapshot, team_tag_snapshot, status, created_at, updated_at) VALUES\n"
            + ",\n".join(vals)
            + ";"
        )
        lines.append("")

    lineup_vals = []
    for team in teams:
        team_players = player_by_team.get(team["id"], [])
        for p in team_players:
            if not p.get("steamid64"):
                continue
            lineup_vals.append(
                "("
                + ",".join(
                    [
                        sql_value(team["id"]),
                        sql_value(p["position"]),
                        sql_value(p["id"]),
                        sql_value(p["nickname"]),
                        sql_value(p["steamid64"]),
                        sql_value(p["updated_at"]),
                    ]
                )
                + ")"
            )
    if lineup_vals:
        lines.append(
            "INSERT INTO lineup_current (tournament_team_id, position, player_id, nickname_snapshot, steamid64_snapshot, updated_at) VALUES\n"
            + ",\n".join(lineup_vals)
            + ";"
        )
        lines.append("")

    lines.append("COMMIT;")

    DATA_SQL.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    write_ddl()
    write_data()
    print(f"generated: {DDL_SQL}")
    print(f"generated: {DATA_SQL}")
