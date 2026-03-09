import os from "node:os";
import path from "node:path";
import { createRandomFn } from "./random.js";

function requireValue(value, key) {
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function inferDefaultTemperature(baseUrl, model) {
  const providerHint = `${baseUrl} ${model}`.toLowerCase();
  if (providerHint.includes("moonshot") || providerHint.includes("kimi")) {
    return 1;
  }
  return 0.7;
}

function listProfilesFromEnv() {
  const profiles = [];
  for (let index = 1; index <= 5; index += 1) {
    const prefix = `LLM_PROFILE_${index}_`;
    const apiKey = process.env[`${prefix}API_KEY`];
    const baseUrl = process.env[`${prefix}BASE_URL`];
    const model = process.env[`${prefix}MODEL`];
    const endpoint = process.env[`${prefix}ENDPOINT`] ?? "/chat/completions";
    const name = process.env[`${prefix}NAME`] ?? `profile-${index}`;
    if (apiKey && baseUrl && model) {
      profiles.push({ key: String(index), name, apiKey, baseUrl, endpoint, model });
    }
  }
  return profiles;
}

function pickProfile(profiles) {
  if (profiles.length === 0) {
    return null;
  }
  const pick = process.env.LLM_PROFILE_PICK ?? "";
  if (!pick) {
    return profiles[0];
  }
  const byKey = profiles.find((profile) => profile.key === pick);
  if (byKey) {
    return byKey;
  }
  const byName = profiles.find((profile) => profile.name === pick);
  if (byName) {
    return byName;
  }
  return profiles[0];
}

function pickFallbackProfile(profiles, primaryProfile) {
  const pick = process.env.LLM_FALLBACK_PROFILE_PICK ?? "";
  if (!pick) {
    return null;
  }
  const byKey = profiles.find((profile) => profile.key === pick);
  const byName = profiles.find((profile) => profile.name === pick);
  const picked = byKey ?? byName ?? null;
  if (!picked) {
    return null;
  }
  if (primaryProfile && picked.key === primaryProfile.key) {
    return null;
  }
  return picked;
}

function selectModelFromEnv(defaultModel) {
  const candidates = [
    process.env.LLM_MODEL_1,
    process.env.LLM_MODEL_2,
    process.env.LLM_MODEL_3,
  ].filter(Boolean);
  const pick = process.env.LLM_MODEL_PICK ?? "";
  if (!pick) {
    return { model: defaultModel, candidates };
  }
  if (/^\d+$/.test(pick)) {
    const index = Number(pick) - 1;
    if (index >= 0 && index < candidates.length) {
      return { model: candidates[index], candidates };
    }
  }
  if (candidates.includes(pick)) {
    return { model: pick, candidates };
  }
  return { model: pick, candidates };
}

export function loadSocialConfig() {
  const useLLM = (process.env.USE_LLM ?? "1") !== "0";
  if (!useLLM) {
    throw new Error("Social simulation requires USE_LLM=1 (pure LLM action generation mode).");
  }

  const profiles = listProfilesFromEnv();
  const selectedProfile = pickProfile(profiles);
  const selectedFallbackProfile = pickFallbackProfile(profiles, selectedProfile);
  const apiKey = selectedProfile?.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const baseUrl = selectedProfile?.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const endpoint = selectedProfile?.endpoint ?? process.env.LLM_ENDPOINT ?? "/chat/completions";
  const defaultModel = selectedProfile?.model ?? process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o";

  const modelSelection = selectModelFromEnv(defaultModel);
  const model = modelSelection.model;
  const defaultTemperature = inferDefaultTemperature(baseUrl, model);
  const temperature = Number(process.env.LLM_TEMPERATURE ?? defaultTemperature);
  const traceEnabled = process.env.SIM_TRACE_LLM_IO
    ? process.env.SIM_TRACE_LLM_IO === "1"
    : process.env.DEBUG_MODE === "1";
  const traceRoot = process.env.SIM_TRACE_DIR ?? path.join(os.tmpdir(), "world-simulator", "llm-trace");
  const traceRunId = new Date().toISOString().replaceAll(":", "-");
  const traceRunDir = path.join(traceRoot, traceRunId);
  const randomSeed = process.env.SIM_RANDOM_SEED ?? "";
  const randomFn = createRandomFn(randomSeed);

  const config = {
    steps: Number(process.env.SIM_STEPS ?? 8),
    maxActorsPerTick: Math.max(0, Number(process.env.SIM_MAX_ACTORS_PER_TICK ?? 0)),
    activeRatioPerTick: Math.min(1, Math.max(0.05, Number(process.env.SIM_ACTIVE_RATIO_PER_TICK ?? 0.45))),
    planningMode: process.env.SIM_PLANNING_MODE ?? "sequential",
    llmConcurrency: Math.max(1, Number(process.env.SIM_LLM_CONCURRENCY ?? 4)),
    orchestrationMode: process.env.SIM_ORCHESTRATION_MODE ?? "hierarchical",
    dbPath: process.env.SIM_DB_PATH ?? path.join(os.tmpdir(), "world-simulator", "sim.db"),
    historyDir: process.env.SIM_HISTORY_DIR ?? "",
    randomSeed,
    randomFn,
    randomness: {
      decisionNoise: Math.max(0, Number(process.env.SIM_DECISION_NOISE ?? 0.15)),
      battleNoise: Math.max(0, Number(process.env.SIM_BATTLE_NOISE ?? 0.2)),
    },
    debug: process.env.DEBUG_MODE === "1",
    llm: {
      enabled: true,
      apiKey: requireValue(apiKey, "LLM_API_KEY or OPENAI_API_KEY"),
      baseUrl,
      endpoint,
      model,
      modelCandidates: modelSelection.candidates,
      selectedProfile: selectedProfile?.name ?? null,
      availableProfiles: profiles.map((profile) => profile.name),
      temperature,
      maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 900),
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30000),
      retryCount: Math.max(1, Number(process.env.LLM_RETRY_COUNT ?? 3)),
      retryBackoffMs: Math.max(0, Number(process.env.LLM_RETRY_BACKOFF_MS ?? 600)),
      historyBriefDays: Math.max(1, Number(process.env.SIM_HISTORY_BRIEF_DAYS ?? 2)),
      historyBriefMaxItems: Math.max(1, Number(process.env.SIM_HISTORY_BRIEF_MAX_ITEMS ?? 8)),
      speechMaxChars: Math.max(20, Number(process.env.SIM_SPEECH_MAX_CHARS ?? 80)),
      summaryMaxChars: Math.max(30, Number(process.env.SIM_SUMMARY_MAX_CHARS ?? 120)),
      rationaleMaxChars: Math.max(40, Number(process.env.SIM_RATIONALE_MAX_CHARS ?? 160)),
      debug: process.env.DEBUG_MODE === "1",
      traceEnabled,
      traceRunDir,
      fallback: selectedFallbackProfile
        ? {
            name: selectedFallbackProfile.name,
            apiKey: selectedFallbackProfile.apiKey,
            baseUrl: selectedFallbackProfile.baseUrl,
            endpoint: selectedFallbackProfile.endpoint,
            model: selectedFallbackProfile.model,
          }
        : null,
    },
  };
  return config;
}

export function maskKey(key) {
  if (!key) {
    return "none";
  }
  const head = key.slice(0, 4);
  const tail = key.slice(-4);
  return `${head}...${tail}`;
}
