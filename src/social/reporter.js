import { timelineLabel } from "./timeLabel.js";

function factionAggregate(world) {
  const totals = {};
  for (const agent of Object.values(world.agents)) {
    const faction = agent.identity.faction;
    if (!totals[faction]) {
      totals[faction] = { confidence: 0, members: 0, resources: {} };
    }
    totals[faction].confidence += Number(agent.internalState.confidence ?? 0);
    totals[faction].members += 1;

    for (const [key, raw] of Object.entries(agent.resources ?? {})) {
      if (key === "time") {
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        continue;
      }
      totals[faction].resources[key] = (totals[faction].resources[key] ?? 0) + value;
    }
  }
  return totals;
}

export function printEventBlockTrace(world, blockInfo) {
  const events = world.eventLog.slice(blockInfo.startEventIndex);
  console.log("");
  console.log(`== 事件块 #${blockInfo.step + 1} ==`);
  console.log(`时间块: ${blockInfo.startLabel} -> ${blockInfo.endLabel} (${blockInfo.timeBlock.days}天)`);
  if (events.length === 0) {
    console.log("本块无关键事件。");
    return;
  }

  for (const event of events) {
    console.log(`- [${timelineLabel(world, event.day, event.phase)}] ${event.actor}: ${event.description}`);
    if (Array.isArray(event.actions) && event.actions.length > 0) {
      for (const item of event.actions.slice(0, 4)) {
        console.log(`  行动[${item.type}]: ${item.description}`);
      }
    }
    if (Array.isArray(event.dialogue) && event.dialogue.length > 0) {
      for (const turn of event.dialogue.slice(0, 4)) {
        const speaker = world.agents?.[turn.speakerId]?.name ?? turn.speakerId;
        console.log(`  对话: ${speaker}：${turn.text}`);
      }
    }
  }
}

export function printSimulationReport(world, config, runtime) {
  console.log("");
  console.log("== 社会模拟沙盘结果 ==");
  console.log(world.title);
  console.log(`总步数: ${config.steps}`);
  console.log(`最终时间: ${timelineLabel(world, world.time.day, world.time.phase)} (tick ${world.time.tick})`);
  console.log(`LLM 模型: ${config.llm.model}`);
  console.log(`总事件数: ${world.eventLog.length}`);
  console.log(`用时: ${runtime}ms`);
  console.log("");
  console.log("== 群体态势 ==");
  const aggregates = factionAggregate(world);
  for (const [faction, value] of Object.entries(aggregates)) {
    const avgConfidence = value.members ? value.confidence / value.members : 0;
    const resourceSummary = Object.entries(value.resources ?? {})
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, 3)
      .map(([key, amount]) => `${key}=${Number(amount).toFixed(2)}`)
      .join(" | ");
    console.log(`- ${faction}: 成员 ${value.members}, 平均信心 ${avgConfidence.toFixed(2)}${resourceSummary ? `, 资源 ${resourceSummary}` : ""}`);
  }
}
