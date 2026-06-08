-- Recommended normalized schema for lineup management
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
