import { timelineLabel } from "./timeLabel.js";

function factionAggregate(world) {
  const totals = {};
  for (const agent of Object.values(world.agents)) {
    const faction = agent.identity.faction;
    if (!totals[faction]) {
      totals[faction] = { troops: 0, influence: 0, confidence: 0, members: 0 };
    }
    totals[faction].troops += agent.resources.troops;
    totals[faction].influence += agent.resources.influence;
    totals[faction].confidence += agent.internalState.confidence;
    totals[faction].members += 1;
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
  console.log("== 阵营态势 ==");
  const aggregates = factionAggregate(world);
  for (const [faction, value] of Object.entries(aggregates)) {
    const avgConfidence = value.members ? value.confidence / value.members : 0;
    console.log(
      `- ${faction}: 兵力 ${Math.round(value.troops)}, 影响力 ${value.influence.toFixed(2)}, 平均信心 ${avgConfidence.toFixed(2)}`,
    );
  }
}
