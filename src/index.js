import { createChaisangScenario } from "./scenarios/chaisang.js";
import { runSimulation, runSimulationAsync } from "./simulator.js";

const PHASE_LABEL = {
  morning: "早晨",
  day: "白天",
  night: "夜晚",
};

const world = createChaisangScenario();
const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const llmEnabled = (process.env.USE_LLM ?? "1") !== "0" && Boolean(llmApiKey);
const debugMode = process.env.DEBUG_MODE === "1";
const result = llmEnabled
  ? await runSimulationAsync(world, 3, {
      enableLLM: true,
      debug: debugMode,
      llm: {
        apiKey: llmApiKey,
        model: process.env.LLM_MODEL ?? process.env.OPENAI_MODEL,
        baseUrl: process.env.LLM_BASE_URL,
        endpoint: process.env.LLM_ENDPOINT,
      },
    })
  : runSimulation(world, 3, { debug: debugMode });

console.log("== 世界 ==");
console.log(result.title);
console.log(`第 ${result.time.day} 天，时段 ${PHASE_LABEL[result.time.phase] ?? result.time.phase}，tick ${result.time.tick}`);
console.log(`决策模式：${llmEnabled ? "混合策略 + LLM" : "混合策略（本地顾问）"}`);
console.log("");
console.log("== 最近事件 ==");
for (const event of result.eventLog) {
  console.log(`- [${PHASE_LABEL[event.phase] ?? event.phase}] ${event.description}`);
}
console.log("");
console.log("== 叙事场景 ==");
for (const scene of result.sceneLog) {
  console.log(`- ${scene.title}: ${scene.summary}`);
}

if (debugMode) {
  console.log("");
  console.log("== Debug 决策轨迹 ==");
  for (const record of result.metadata.debug?.decisions ?? []) {
    const phase = PHASE_LABEL[record.phase] ?? record.phase;
    const drivers = record.topDrivers
      .map((driver) => `${driver.name}:${driver.value}`)
      .join(" | ");
    console.log(`- [tick ${record.tick} ${phase}] ${record.agent} (${record.mode}/${record.advisorSource})`);
    console.log(`  驱动：${drivers}`);
    console.log(`  评分：${JSON.stringify(record.blendedScores)}`);
    console.log(`  理由：${record.rationale}`);
  }
}
