import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    status: text("status").notNull(), // active | ended
    createdAt: text("created_at").notNull(),
    endedAt: text("ended_at"),
  },
  (t) => ({
    codeUq: uniqueIndex("sessions_code_uq").on(t.code),
  }),
);

export const invites = sqliteTable(
  "invites",
  {
    token: text("token").primaryKey(),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull(), // admin | mod | observer
    createdAt: text("created_at").notNull(),
    label: text("label"),
  },
  (t) => ({
    sessionIdIdx: index("invites_session_id_idx").on(t.sessionId),
  }),
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    deviceId: text("device_id"),
    status: text("status").notNull(), // active | disabled
    displayName: text("display_name").notNull(),
    cardJson: text("card_json").notNull(),
    createdAt: text("created_at").notNull(),
    disabledAt: text("disabled_at"),
    disabledReason: text("disabled_reason"),
    disabledBy: text("disabled_by"),
  },
  (t) => ({
    sessionIdIdx: index("participants_session_id_idx").on(t.sessionId),
    sessionDeviceUq: uniqueIndex("participants_session_device_uq").on(t.sessionId, t.deviceId),
    sessionDeviceIdx: index("participants_session_device_idx").on(t.sessionId, t.deviceId),
    sessionStatusIdx: index("participants_session_status_idx").on(t.sessionId, t.status),
  }),
);

export const drawCommits = sqliteTable(
  "draw_commits",
  {
    sessionId: text("session_id").notNull(),
    seq: integer("seq").notNull(),
    number: integer("number").notNull(),
    committedAt: text("committed_at").notNull(),
    reachCount: integer("reach_count"),
    bingoCount: integer("bingo_count"),
    newBingoCount: integer("new_bingo_count"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.seq] }),
    numberUq: uniqueIndex("draw_commits_session_number_uq").on(t.sessionId, t.number),
    sessionIdIdx: index("draw_commits_session_id_idx").on(t.sessionId),
  }),
);
