import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

// ============================================================
// 系统表（禁止删除）
// ============================================================
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "string",
  }).defaultNow(),
});

// ============================================================
// 比赛表
// ============================================================
export const tournaments = pgTable(
  "tournaments",
  {
    id: serial().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    league_id: varchar("league_id", { length: 128 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tournaments_league_id_idx").on(table.league_id),
    index("tournaments_updated_at_idx").on(table.updated_at),
  ]
);

// ============================================================
// 战队表
// ============================================================
export const teams = pgTable(
  "teams",
  {
    id: serial().primaryKey(),
    tournament_id: integer("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    short_name: varchar("short_name", { length: 64 }),
    team_id: varchar("team_id", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull().default("缺失"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("teams_tournament_id_idx").on(table.tournament_id),
    index("teams_team_id_idx").on(table.team_id),
    index("teams_status_idx").on(table.status),
  ]
);

// ============================================================
// 选手表
// ============================================================
export const players = pgTable(
  "players",
  {
    id: serial().primaryKey(),
    team_id: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 128 }).notNull(),
    steamid64: varchar("steamid64", { length: 32 }),
    position: integer("position").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("players_team_id_idx").on(table.team_id),
    index("players_steamid64_idx").on(table.steamid64),
    index("players_position_idx").on(table.position),
  ]
);

// ============================================================
// Zod 校验 Schema
// ============================================================
const { createInsertSchema: createCoercedInsertSchema } = createSchemaFactory({
  coerce: { date: true },
});

export const insertTournamentSchema = createCoercedInsertSchema(
  tournaments
).pick({ name: true, league_id: true });

export const updateTournamentSchema = createCoercedInsertSchema(tournaments)
  .pick({ name: true, league_id: true })
  .partial();

export const insertTeamSchema = createCoercedInsertSchema(teams).pick({
  tournament_id: true,
  name: true,
  short_name: true,
  team_id: true,
});

export const updateTeamSchema = createCoercedInsertSchema(teams)
  .pick({ name: true, short_name: true, team_id: true, status: true })
  .partial();

export const insertPlayerSchema = createCoercedInsertSchema(players).pick({
  team_id: true,
  nickname: true,
  steamid64: true,
  position: true,
});

export const updatePlayerSchema = createCoercedInsertSchema(players)
  .pick({ nickname: true, steamid64: true, position: true })
  .partial();

// ============================================================
// 类型导出
// ============================================================
export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type UpdateTournament = z.infer<typeof updateTournamentSchema>;

export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type UpdateTeam = z.infer<typeof updateTeamSchema>;

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type UpdatePlayer = z.infer<typeof updatePlayerSchema>;
