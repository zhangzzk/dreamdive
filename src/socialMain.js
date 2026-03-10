import { loadSocialConfig, maskKey } from "./social/config.js";
import { runSocialSimulation } from "./social/engine.js";
import { runHierarchicalSimulation } from "./social/hierarchicalEngine.js";
import { writeHistoryDump } from "./social/historyDump.js";
import { printSimulationReport } from "./social/reporter.js";
import { createRedCliffInitialState } from "./social/seedRedCliff.js";
import { bootstrapWorldFromSources } from "./social/worldBootstrap.js";

function usingBootstrapMode() {
  return Boolean(String(process.env.SIM_SOURCE_FILES ?? "").trim());
}

function bootstrapOnlyMode() {
  return String(process.env.SIM_BOOTSTRAP_ONLY ?? "0") === "1";
}

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
  console.log(`SIM framework: ${config.frameworkPath} (${config.frameworkLoaded ? "loaded" : "default"})`);

  let initial;
  if (usingBootstrapMode()) {
    const sourceFiles = String(process.env.SIM_SOURCE_FILES ?? "").trim();
    const startNode = String(process.env.SIM_START_NODE ?? "").trim();
    const boot = await bootstrapWorldFromSources(config, { sourceFiles, startNode });
    initial = boot.world;
    console.log(`SIM bootstrap: on (${boot.sourceFiles.length} files)`);
    if (Array.isArray(boot.sourceFileEncodings) && boot.sourceFileEncodings.length > 0) {
      const encPreview = boot.sourceFileEncodings
        .slice(0, 8)
        .map((item) => `${item.encoding}:${item.path}`)
        .join(" | ");
      console.log(`SIM bootstrap encodings: ${encPreview}`);
    }
    if (Array.isArray(boot.skippedEntries) && boot.skippedEntries.length > 0) {
      console.log(`SIM bootstrap skipped entries: ${JSON.stringify(boot.skippedEntries)}`);
    }
    if (boot.selectedTimelineNode) {
      console.log(`SIM start node: ${boot.selectedTimelineNode}`);
    }
    if (Array.isArray(boot.startNodeCandidates) && boot.startNodeCandidates.length > 0) {
      const preview = boot.startNodeCandidates.slice(0, 8).map((item) => `${item.id || "?"}:${item.label || ""}`).join(" | ");
      console.log(`SIM start node candidates: ${preview}`);
    }
    console.log(`SIM scenario id: ${boot.scenarioId}`);
    console.log(`SIM bootstrap cache: ${boot.fromCache ? "hit" : "miss"}`);
    if (boot.fromCache) {
      console.log("SIM bootstrap ingest: reused cached world seed (no new bootstrap LLM extraction)");
    } else if (boot.ingestStats) {
      const st = boot.ingestStats;
      console.log(`SIM bootstrap ingest chars: total=${st.totalChars} chunk_sent=${st.sentChunkChars} coverage=${st.coverage}`);
      console.log(`SIM bootstrap ingest chunks: used=${st.usedChunks}/${st.maxChunks} possible=${st.possibleChunks}`);
      console.log(`SIM bootstrap truncation: chunk=${st.chunkTruncated} sourceDigest=${st.sourceDigestTruncated} rawContext=${st.rawContextTruncated}`);
    }

    if (bootstrapOnlyMode()) {
      console.log("SIM bootstrap-only: done (no simulation executed)");
      process.exit(0);
    }
  } else {
    initial = createRedCliffInitialState();
    console.log("SIM bootstrap: off (using built-in Red Cliff seed)");
  }
  console.log("");

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
