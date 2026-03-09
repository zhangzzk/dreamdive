import { loadSocialConfig, maskKey } from "./social/config.js";
import { runSocialSimulation } from "./social/engine.js";
import { runHierarchicalSimulation } from "./social/hierarchicalEngine.js";
import { writeHistoryDump } from "./social/historyDump.js";
import { printSimulationReport } from "./social/reporter.js";
import { createRedCliffInitialState } from "./social/seedRedCliff.js";

try {
  const config = loadSocialConfig();
  console.log(`LLM API key active: yes (${maskKey(config.llm.apiKey)})`);
  console.log(`LLM endpoint: ${config.llm.baseUrl}${config.llm.endpoint}`);
  console.log(`LLM model: ${config.llm.model}`);
  if (config.llm.fallback?.model) {
    console.log(`LLM fallback model: ${config.llm.fallback.model} (${config.llm.fallback.name})`);
  }
  if (config.llm.selectedProfile) {
    console.log(`LLM profile: ${config.llm.selectedProfile}`);
  }
  if (Array.isArray(config.llm.availableProfiles) && config.llm.availableProfiles.length > 0) {
    console.log(`LLM profiles: ${config.llm.availableProfiles.join(" | ")}`);
  }
  if (Array.isArray(config.llm.modelCandidates) && config.llm.modelCandidates.length > 0) {
    console.log(`LLM model candidates: ${config.llm.modelCandidates.join(" | ")}`);
  }
  console.log(`LLM temperature: ${Number.isFinite(config.llm.temperature) ? config.llm.temperature : "auto"}`);
  console.log(`LLM timeout: ${config.llm.timeoutMs}ms`);
  console.log(`LLM retry: ${config.llm.retryCount} (backoff ${config.llm.retryBackoffMs}ms)`);
  console.log(`LLM trace IO: ${config.llm.traceEnabled ? `on (${config.llm.traceRunDir})` : "off"}`);
  console.log(`SIM steps: ${config.steps}`);
  console.log(`SIM planning mode: ${config.planningMode}`);
  console.log(`SIM active ratio/tick: ${config.activeRatioPerTick}`);
  console.log(`SIM max actors/tick: ${config.maxActorsPerTick > 0 ? config.maxActorsPerTick : "all"}`);
  console.log(`SIM LLM concurrency: ${config.llmConcurrency}`);
  console.log(`SIM random seed: ${config.randomSeed || "auto"}`);
  console.log(`SIM noise(decision/battle): ${config.randomness.decisionNoise}/${config.randomness.battleNoise}`);
  console.log(`SIM orchestration: ${config.orchestrationMode}`);
  console.log(`SIM db path: ${config.dbPath}`);
  console.log("");

  const initial = createRedCliffInitialState();
  const started = Date.now();
  const result = config.orchestrationMode === "hierarchical"
    ? await runHierarchicalSimulation(initial, config)
    : await runSocialSimulation(initial, config);
  const runtime = Date.now() - started;

  printSimulationReport(result, config, runtime);
  const dumpPath = await writeHistoryDump(result, config, runtime);
  console.log("");
  console.log(`历史记录已保存: ${dumpPath}`);
} catch (error) {
  console.error("Startup failed:", error.message);
  process.exitCode = 1;
}
