import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const initializedDirs = new Set();

function toSafeId(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function ensureDir(dir) {
  if (initializedDirs.has(dir)) {
    return;
  }
  await mkdir(dir, { recursive: true });
  initializedDirs.add(dir);
}

export async function writeLlmTrace(entry) {
  const traceDir = entry?.traceDir;
  if (!traceDir) {
    return null;
  }
  await ensureDir(traceDir);

  const actorId = toSafeId(entry.actorId);
  const fileName = `${nowStamp()}-tick${entry.tick}-a${entry.attempt}-${actorId}.md`;
  const filePath = path.join(traceDir, fileName);

  const lines = [];
  lines.push("# LLM Trace");
  lines.push("");
  lines.push(`- actor_id: ${entry.actorId}`);
  lines.push(`- actor_name: ${entry.actorName}`);
  lines.push(`- tick: ${entry.tick}`);
  lines.push(`- day: ${entry.day}`);
  lines.push(`- phase: ${entry.phase}`);
  lines.push(`- attempt: ${entry.attempt}`);
  lines.push(`- status: ${entry.status}`);
  if (entry.error) {
    lines.push(`- error: ${entry.error}`);
  }
  lines.push("");
  lines.push("## Prompt Messages");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(entry.messages, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Raw LLM Output");
  lines.push("");
  lines.push("```text");
  lines.push(entry.rawOutput ?? "");
  lines.push("```");
  lines.push("");

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

export async function writePlannerTrace(entry) {
  const traceDir = entry?.traceDir;
  if (!traceDir) {
    return null;
  }
  await ensureDir(traceDir);

  const kind = toSafeId(entry.kind ?? "planner");
  const eventId = toSafeId(entry.eventId ?? "none");
  const fileName = `${nowStamp()}-step${entry.step}-${kind}-${eventId}.md`;
  const filePath = path.join(traceDir, fileName);

  const lines = [];
  lines.push("# Planner Trace");
  lines.push("");
  lines.push(`- kind: ${entry.kind}`);
  lines.push(`- step: ${entry.step}`);
  if (entry.day !== undefined) {
    lines.push(`- day: ${entry.day}`);
  }
  if (entry.phase !== undefined) {
    lines.push(`- phase: ${entry.phase}`);
  }
  if (entry.eventId) {
    lines.push(`- event_id: ${entry.eventId}`);
  }
  if (entry.status) {
    lines.push(`- status: ${entry.status}`);
  }
  if (entry.error) {
    lines.push(`- error: ${entry.error}`);
  }
  lines.push("");
  lines.push("## Prompt Messages");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(entry.messages ?? [], null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Raw LLM Output");
  lines.push("");
  lines.push("```text");
  lines.push(entry.rawOutput ?? "");
  lines.push("```");
  lines.push("");

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}
