import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { timelineLabel } from "./timeLabel.js";

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

export async function writeHistoryDump(world, config, runtime) {
  const baseDir = config.historyDir || path.join(os.tmpdir(), "world-simulator");
  await mkdir(baseDir, { recursive: true });
  const filename = `social-history-${nowStamp()}.md`;
  const filePath = path.join(baseDir, filename);

  const lines = [];
  lines.push("# 社会模拟历史记录");
  lines.push("");
  lines.push(`- 世界: ${world.title}`);
  lines.push(`- 步数: ${config.steps}`);
  lines.push(`- 用时: ${runtime}ms`);
  lines.push(`- 模型: ${config.llm.model}`);
  lines.push("");
  lines.push("## 事件轨迹");
  lines.push("");
  for (const event of world.eventLog) {
    lines.push(`- [${timelineLabel(world, event.day, event.phase)} | tick ${event.tick}] ${event.actor}`);
    lines.push(`  - 行为: ${event.description}`);
    if (Array.isArray(event.actions) && event.actions.length > 0) {
      for (const item of event.actions.slice(0, 8)) {
        lines.push(`  - 行动[${item.type}]: ${item.description}`);
      }
    }
    if (Array.isArray(event.dialogue) && event.dialogue.length > 0) {
      for (const turn of event.dialogue.slice(0, 10)) {
        const speaker = world.agents?.[turn.speakerId]?.name ?? turn.speakerId;
        lines.push(`  - 对话: ${speaker}：${turn.text}`);
      }
    }
  }

  if (config.debug && world.metadata?.debug?.decisions?.length) {
    lines.push("");
    lines.push("## Debug 决策");
    lines.push("");
    for (const decision of world.metadata.debug.decisions) {
      const drivers = decision.drivers
        .map((driver) => `${driver.factor}:${Number(driver.weight).toFixed(2)}(${driver.evidence})`)
        .join(" | ");
      lines.push(`- [${timelineLabel(world, decision.day, decision.phase)} | tick ${decision.tick}] ${decision.agent} -> ${decision.actionLabel}`);
      lines.push(`  - 驱动: ${drivers}`);
      lines.push(`  - 理由: ${decision.rationale}`);
      if (Array.isArray(decision.actions) && decision.actions.length > 0) {
        for (const item of decision.actions.slice(0, 8)) {
          lines.push(`  - 行动[${item.type}]: ${item.description}`);
        }
      }
      if (Array.isArray(decision.dialogue) && decision.dialogue.length > 0) {
        for (const turn of decision.dialogue.slice(0, 10)) {
          lines.push(`  - 对话: ${turn.speakerId} -> ${turn.targetIds?.join("、") || "all"}: ${turn.text}`);
        }
      }
    }
  }

  lines.push("");
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}
