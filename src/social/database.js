import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

export function createSimulationDatabase(dbPath) {
  ensureParentDir(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS main_event_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      prompt_json TEXT NOT NULL,
      response_raw TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub_event_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      prompt_json TEXT NOT NULL,
      response_raw TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      parent_event_id TEXT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      participants_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      world_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function createRun(db, worldTitle, config) {
  const runId = `run-${Date.now()}`;
  const stmt = db.prepare(
    "INSERT INTO simulation_runs (run_id, created_at, title, config_json) VALUES (?, ?, ?, ?)",
  );
  stmt.run(runId, nowIso(), worldTitle, JSON.stringify(config));
  return runId;
}

export function writeMainEventChat(db, runId, step, promptMessages, responseRaw, planObject) {
  const stmt = db.prepare(`
    INSERT INTO main_event_chats
      (run_id, step, prompt_json, response_raw, plan_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    runId,
    step,
    JSON.stringify(promptMessages),
    responseRaw,
    JSON.stringify(planObject),
    nowIso(),
  );
}

export function writeSubEventChat(db, runId, step, eventId, promptMessages, responseRaw, summaryObject) {
  const stmt = db.prepare(`
    INSERT INTO sub_event_chats
      (run_id, step, event_id, prompt_json, response_raw, summary_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    runId,
    step,
    eventId,
    JSON.stringify(promptMessages),
    responseRaw,
    JSON.stringify(summaryObject),
    nowIso(),
  );
}

export function writeEventRecord(db, runId, step, event) {
  const stmt = db.prepare(`
    INSERT INTO events
      (run_id, step, event_id, parent_event_id, event_type, title, summary, participants_json, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    runId,
    step,
    event.eventId,
    event.parentEventId ?? null,
    event.eventType,
    event.title,
    event.summary,
    JSON.stringify(event.participants ?? []),
    JSON.stringify(event.payload ?? {}),
    nowIso(),
  );
}

export function writeSnapshot(db, runId, step, world) {
  const stmt = db.prepare(`
    INSERT INTO world_snapshots
      (run_id, step, world_json, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(runId, step, JSON.stringify(world), nowIso());
}
