import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createWorldState } from "../model.js";
import { requestJsonFromLLM } from "./llmClient.js";
import { parseJsonLenient } from "./jsonUtil.js";
import {
  createSimulationDatabase,
  listBootstrapArtifactsByKey,
  readBootstrapArtifact,
  writeBootstrapArtifact,
} from "./database.js";
import { resolvePromptLines, resolvePromptText } from "./framework.js";

const MAX_SOURCE_TOTAL = 70000;
const MAX_RAW_CONTEXT = 22000;
const MAX_CHUNK_CHARS = 10000;
const MAX_CHUNKS = 6;
const SOURCE_FILE_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return clamp(num, 0, 1);
}

function clamp11(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return clamp(num, -1, 1);
}

function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function toStringList(value, max = 16) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, max);
}

function toGlossary(value, max = 24) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      term: String(item?.term ?? "").trim(),
      meaning: String(item?.meaning ?? "").trim(),
      aliases: toStringList(item?.aliases ?? [], 8),
    }))
    .filter((item) => item.term)
    .slice(0, max);
}

function toNumberOr(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return clamp(num, min, max);
}

function normalizePublicOpinionSeed(input) {
  const source = toObject(input);
  const result = {};
  for (const [key, raw] of Object.entries(source)) {
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      continue;
    }
    const normalizedKey = String(key)
      .trim()
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase();
    result[normalizedKey] = clamp01(num, 0.5);
  }
  return result;
}

function slugify(input, fallback) {
  const text = String(input ?? fallback ?? "item").toLowerCase();
  const slug = text.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || String(fallback ?? "item");
}

function parseSourceFiles(raw) {
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shouldSkipDir(name) {
  return name === ".git" || name === "node_modules" || name.startsWith(".");
}

function isSupportedSourceFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_FILE_EXTS.has(ext);
}

async function listFilesRecursively(absPath, result) {
  const entries = await readdir(absPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) {
        continue;
      }
      await listFilesRecursively(path.join(absPath, entry.name), result);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(absPath, entry.name);
    if (isSupportedSourceFile(fullPath)) {
      result.push(fullPath);
    }
  }
}

async function resolveSourceFilePaths(sourceEntries) {
  const resolved = [];
  const skipped = [];

  for (const entry of sourceEntries) {
    const absPath = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
    let info;
    try {
      info = await stat(absPath);
    } catch {
      skipped.push({ entry, reason: "not_found" });
      continue;
    }

    if (info.isFile()) {
      if (isSupportedSourceFile(absPath)) {
        resolved.push(absPath);
      } else {
        skipped.push({ entry, reason: "unsupported_extension" });
      }
      continue;
    }

    if (info.isDirectory()) {
      const files = [];
      await listFilesRecursively(absPath, files);
      if (files.length === 0) {
        skipped.push({ entry, reason: "empty_or_no_supported_files" });
      }
      resolved.push(...files);
      continue;
    }

    skipped.push({ entry, reason: "unsupported_path_type" });
  }

  return {
    files: Array.from(new Set(resolved)).sort(),
    skipped,
  };
}

function scoreDecodedText(text) {
  if (!text) {
    return -1e9;
  }
  const len = text.length;
  const replacementCount = (text.match(/�/g) ?? []).length;
  const cjkCount = (text.match(/[一-鿿]/g) ?? []).length;
  const weirdCount = (text.match(/[√˜£∫±æŒ∞¡◊µª¥÷øÃπ°”’«]/g) ?? []).length;
  const replacementRatio = replacementCount / Math.max(1, len);
  const cjkRatio = cjkCount / Math.max(1, len);
  const weirdRatio = weirdCount / Math.max(1, len);
  return cjkRatio * 4 - replacementRatio * 12 - weirdRatio * 6;
}

function decodeBufferWithCandidates(buffer) {
  const encodings = ["utf-8", "gb18030", "big5", "utf-16le"];
  let best = { text: buffer.toString("utf8"), encoding: "utf-8", score: -1e9 };

  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const text = decoder.decode(buffer);
      const score = scoreDecodedText(text);
      if (score > best.score) {
        best = { text, encoding, score };
      }
    } catch {
      continue;
    }
  }

  return best;
}

async function loadMaterials(sourceFiles) {
  const files = [];
  for (const filePath of sourceFiles) {
    const raw = await readFile(filePath);
    const decoded = decodeBufferWithCandidates(raw);
    files.push({
      path: filePath,
      content: decoded.text,
      encoding: decoded.encoding,
    });
  }
  return files;
}


function buildSourceSignature(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(String(file.path));
    hash.update("\n");
    hash.update(String(file.encoding ?? ""));
    hash.update("\n");
    hash.update(String(file.content ?? ""));
    hash.update("\n---\n");
  }
  return hash.digest("hex");
}

function findCachedBootstrap(db, sourceSignature, requestedStartNode) {
  const targetNode = String(requestedStartNode ?? "").trim();
  const candidates = listBootstrapArtifactsByKey(db, "result", "cache_meta", 300);
  for (const item of candidates) {
    const meta = item.payload ?? {};
    if (String(meta.source_signature ?? "") !== sourceSignature) {
      continue;
    }
    if (String(meta.requested_start_node ?? "") !== targetNode) {
      continue;
    }

    const worldSeed = readBootstrapArtifact(db, item.scenarioId, "result", "world_seed");
    if (!worldSeed) {
      continue;
    }
    const startNodeCandidates = readBootstrapArtifact(db, item.scenarioId, "result", "start_node_candidates");
    const startContext = readBootstrapArtifact(db, item.scenarioId, "llm", "start_context");

    return {
      scenarioId: item.scenarioId,
      world: worldSeed,
      selectedTimelineNode: String(startContext?.parsed?.selected_timeline_label ?? ""),
      startNodeCandidates: Array.isArray(startNodeCandidates?.candidates) ? startNodeCandidates.candidates : [],
    };
  }
  return null;
}

function buildSourceDigest(files) {
  const maxFileChars = 18000;
  const pieces = [];
  let total = 0;

  for (const file of files) {
    if (total >= MAX_SOURCE_TOTAL) {
      break;
    }
    const rest = MAX_SOURCE_TOTAL - total;
    const excerpt = file.content.slice(0, Math.min(maxFileChars, rest));
    total += excerpt.length;
    pieces.push(`### Source: ${file.path}\n${excerpt}`);
  }

  return pieces.join("\n\n");
}

function buildMaterialChunks(files) {
  const chunks = [];
  for (const file of files) {
    for (let offset = 0; offset < file.content.length; offset += MAX_CHUNK_CHARS) {
      if (chunks.length >= MAX_CHUNKS) {
        return chunks;
      }
      const piece = file.content.slice(offset, offset + MAX_CHUNK_CHARS);
      if (!piece.trim()) {
        continue;
      }
      chunks.push({
        id: `c${chunks.length + 1}`,
        path: file.path,
        offset,
        text: piece,
      });
    }
  }
  return chunks;
}

async function requestStructuredJson(llmConfig, messages, errorLabel) {
  const framework = llmConfig.framework ?? {};
  const boostConfig = {
    ...llmConfig,
    maxTokens: Math.max(Number(llmConfig.maxTokens ?? 900), 1400),
  };

  const raw = await requestJsonFromLLM(llmConfig, messages);
  let parsed = parseJsonLenient(raw);
  if (parsed && typeof parsed === "object") {
    return { raw, parsed };
  }

  const retryVars = { rawPrefix: String(raw).slice(0, 1200) };
  const retryMessages = [
    ...messages,
    {
      role: "user",
      content: resolvePromptLines(
        framework,
        "prompts.bootstrap.json_retry_user_lines",
        retryVars,
      ).join("\n"),
    },
  ];
  const retryRaw = await requestJsonFromLLM(boostConfig, retryMessages);
  parsed = parseJsonLenient(retryRaw);
  if (parsed && typeof parsed === "object") {
    return { raw: retryRaw, parsed };
  }

  const repairVars = { brokenJson: String(retryRaw || raw).slice(0, 5000) };
  const repairMessages = [
    {
      role: "system",
      content: resolvePromptText(
        framework,
        "prompts.bootstrap.json_repair_system",
        repairVars,
      ),
    },
    {
      role: "user",
      content: resolvePromptLines(
        framework,
        "prompts.bootstrap.json_repair_user_lines",
        repairVars,
      ).join("\n"),
    },
  ];
  const repairedRaw = await requestJsonFromLLM(boostConfig, repairMessages);
  parsed = parseJsonLenient(repairedRaw);
  if (parsed && typeof parsed === "object") {
    return { raw: repairedRaw, parsed };
  }

  const repairMessages2 = [
    {
      role: "system",
      content: resolvePromptText(framework, "prompts.bootstrap.json_repair_system", repairVars),
    },
    {
      role: "user",
      content: `请只返回一个最小合法JSON对象，保留已识别字段并补齐缺失结构。\nbroken_json=${String(repairVars.brokenJson).slice(0, 3000)}`,
    },
  ];
  const repairedRaw2 = await requestJsonFromLLM(boostConfig, repairMessages2);
  parsed = parseJsonLenient(repairedRaw2);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${errorLabel}: JSON_PARSE_FAILED raw=${String(retryRaw || raw).slice(0, 280)}`);
  }
  return { raw: repairedRaw2, parsed };
}


function buildChunkFallbackSummary(chunk) {
  const text = String(chunk?.text ?? "");
  const cleaned = text
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const snippets = cleaned
    .split(/(?<=[。！？.!?])/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => (item.length > 42 ? `${item.slice(0, 42)}...` : item));

  return {
    world_hints: snippets.length > 0 ? snippets : ["文本片段已读取，自动兜底摘要。"],
    timeline_nodes: [],
    characters: [],
    relations: [],
    key_events: [],
  };
}

async function summarizeChunk(llmConfig, chunk) {
  const framework = llmConfig.framework ?? {};
  const vars = {
    chunkId: chunk.id,
    sourcePath: chunk.path,
    offset: chunk.offset,
    chunkText: chunk.text,
  };
  const messages = [
    {
      role: "system",
      content: resolvePromptText(
        framework,
        "prompts.bootstrap.chunk_summary_system",
        vars,
      ),
    },
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.bootstrap.chunk_summary_user_lines", vars).join("\n"),
    },
  ];

  try {
    const { raw, parsed } = await requestStructuredJson(llmConfig, messages, "summarize_chunk_failed");
    return { messages, raw, summary: parsed };
  } catch (error) {
    if (llmConfig.debug) {
      console.log(`[bootstrap] chunk ${chunk.id} parse failed, using fallback summary: ${String(error?.message ?? error).slice(0, 140)}`);
    }
    return {
      messages,
      raw: `FALLBACK_SUMMARY: ${String(error?.message ?? error)}`,
      summary: buildChunkFallbackSummary(chunk),
    };
  }
}

async function summarizeMaterial(llmConfig, files) {
  const chunks = buildMaterialChunks(files);
  const summaries = [];
  for (const chunk of chunks) {
    summaries.push(await summarizeChunk(llmConfig, chunk));
  }
  return { chunks, summaries };
}


function summarizeMaterialCoverage(files, chunks, sourceDigest) {
  const totalChars = files.reduce((sum, item) => sum + String(item.content ?? "").length, 0);
  const sentChunkChars = chunks.reduce((sum, item) => sum + String(item.text ?? "").length, 0);
  const possibleChunks = files.reduce((sum, item) => {
    const len = String(item.content ?? "").length;
    return sum + Math.ceil(len / MAX_CHUNK_CHARS);
  }, 0);
  const chunkTruncated = possibleChunks > MAX_CHUNKS;
  const sourceDigestTruncated = String(sourceDigest ?? "").length >= MAX_SOURCE_TOTAL || totalChars > MAX_SOURCE_TOTAL;
  const rawContextTruncated = String(sourceDigest ?? "").length > MAX_RAW_CONTEXT;
  const coverage = totalChars > 0 ? Number((sentChunkChars / totalChars).toFixed(4)) : 1;

  return {
    totalChars,
    sentChunkChars,
    possibleChunks,
    usedChunks: chunks.length,
    maxChunks: MAX_CHUNKS,
    maxChunkChars: MAX_CHUNK_CHARS,
    sourceDigestChars: String(sourceDigest ?? "").length,
    maxSourceTotal: MAX_SOURCE_TOTAL,
    maxRawContext: MAX_RAW_CONTEXT,
    chunkTruncated,
    sourceDigestTruncated,
    rawContextTruncated,
    coverage,
  };
}
async function extractWorldPack(llmConfig, sourceDigest, chunkSummaries) {
  const framework = llmConfig.framework ?? {};
  const compactSummaries = chunkSummaries.map((item, index) => ({
    index: index + 1,
    summary: item.summary,
  }));
  const vars = {
    chunkSummaries: JSON.stringify(compactSummaries).slice(0, 36000),
    sourceDigest: sourceDigest.slice(0, MAX_RAW_CONTEXT),
  };
  const messages = [
    {
      role: "system",
      content: resolvePromptText(
        framework,
        "prompts.bootstrap.extract_world_pack_system",
        vars,
      ),
    },
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.bootstrap.extract_world_pack_user_lines", vars).join("\n"),
    },
  ];
  const { raw, parsed } = await requestStructuredJson(llmConfig, messages, "extract_world_pack_failed");
  return { messages, raw, pack: parsed };
}

async function designSimulationBlueprint(llmConfig, worldPack) {
  const framework = llmConfig.framework ?? {};
  const vars = {
    worldPack: JSON.stringify(worldPack).slice(0, 42000),
  };
  const messages = [
    {
      role: "system",
      content: resolvePromptText(
        framework,
        "prompts.bootstrap.blueprint_system",
        vars,
      ),
    },
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.bootstrap.blueprint_user_lines", vars).join("\n"),
    },
  ];
  const { raw, parsed } = await requestStructuredJson(llmConfig, messages, "design_blueprint_failed");
  return { messages, raw, blueprint: parsed };
}

function resolveStartNode(worldPack, requested) {
  const nodes = Array.isArray(worldPack?.timeline_nodes) ? worldPack.timeline_nodes : [];
  const cleaned = String(requested ?? "").trim();
  if (!cleaned) {
    return { resolved: "", candidates: nodes.slice(0, 12).map((item) => ({ id: item.id, label: item.label })) };
  }

  const byId = nodes.find((item) => String(item?.id ?? "") === cleaned);
  if (byId) {
    return { resolved: String(byId.id), candidates: nodes.slice(0, 12).map((item) => ({ id: item.id, label: item.label })) };
  }

  const byLabel = nodes.find((item) => String(item?.label ?? "") === cleaned);
  if (byLabel) {
    return { resolved: String(byLabel.id ?? byLabel.label), candidates: nodes.slice(0, 12).map((item) => ({ id: item.id, label: item.label })) };
  }

  const fuzzy = nodes.find((item) => String(item?.label ?? "").includes(cleaned) || cleaned.includes(String(item?.label ?? "")));
  if (fuzzy) {
    return { resolved: String(fuzzy.id ?? fuzzy.label), candidates: nodes.slice(0, 12).map((item) => ({ id: item.id, label: item.label })) };
  }

  return { resolved: cleaned, candidates: nodes.slice(0, 12).map((item) => ({ id: item.id, label: item.label })) };
}

async function buildStartContext(llmConfig, worldPack, startNode) {
  const framework = llmConfig.framework ?? {};
  const vars = {
    startNode: startNode || "",
    worldPack: JSON.stringify(worldPack).slice(0, 42000),
  };
  const messages = [
    {
      role: "system",
      content: resolvePromptText(
        framework,
        "prompts.bootstrap.start_context_system",
        vars,
      ),
    },
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.bootstrap.start_context_user_lines", vars).join("\n"),
    },
  ];
  const { raw, parsed } = await requestStructuredJson(llmConfig, messages, "build_start_context_failed");
  return { messages, raw, startContext: parsed };
}

function buildRelationsMap(characterIds, relationList) {
  const map = {};
  for (const id of characterIds) {
    map[id] = {};
  }
  for (const relation of relationList) {
    const from = String(relation?.from ?? "");
    const to = String(relation?.to ?? "");
    if (!map[from] || !map[to]) {
      continue;
    }
    map[from][to] = {
      trust: clamp11(relation?.trust, 0),
      respect: clamp11(relation?.respect, 0),
      fear: clamp11(relation?.fear, 0),
      resentment: clamp11(relation?.resentment, 0),
      obligation: clamp11(relation?.obligation, 0),
      attraction: clamp11(relation?.attraction, 0),
    };
  }
  for (const from of characterIds) {
    for (const to of characterIds) {
      if (from === to) {
        continue;
      }
      if (!map[from][to]) {
        map[from][to] = {
          trust: 0,
          respect: 0,
          fear: 0,
          resentment: 0,
          obligation: 0,
          attraction: 0,
        };
      }
    }
  }
  return map;
}

function toAgent(character, relationMap) {
  const id = slugify(character?.id ?? character?.name, "agent");
  const canonicalProjection = toObject(character?.canonical_projection);
  const rawTraits = toObject(character?.traits);
  const rawDrives = toObject(character?.drives);
  const rawState = toObject(character?.state);
  const rawResources = toObject(character?.resources);
  const domainInput = toObject(character?.domain);

  const canonicalTraitKeys = new Set(["ambition", "prudence", "impulsiveness", "empathy", "pride", "loyalty", "ruthlessness"]);
  const canonicalDriveKeys = new Set(["survival", "power", "status", "wealth", "belonging", "morality", "desire", "revenge"]);
  const canonicalStateKeys = new Set(["mood", "stress", "fatigue", "confidence"]);
  const canonicalResourceKeys = new Set(["money", "troops", "influence", "information_access", "informationAccess", "time"]);

  const domainTraits = { ...toObject(domainInput.traits) };
  for (const [key, value] of Object.entries(rawTraits)) {
    if (!canonicalTraitKeys.has(key)) {
      domainTraits[key] = value;
    }
  }
  const domainStates = { ...toObject(domainInput.states) };
  for (const [key, value] of Object.entries(rawState)) {
    if (!canonicalStateKeys.has(key)) {
      domainStates[key] = value;
    }
  }
  const domainResources = { ...toObject(domainInput.resources) };
  for (const [key, value] of Object.entries(rawResources)) {
    if (!canonicalResourceKeys.has(key)) {
      domainResources[key] = value;
    }
  }
  const domainDriveAxes = {};
  for (const [key, value] of Object.entries(rawDrives)) {
    if (!canonicalDriveKeys.has(key)) {
      domainDriveAxes[key] = value;
    }
  }

  return {
    id,
    name: String(character?.name ?? id),
    identity: {
      origin: "unknown",
      faction: String(character?.faction ?? "independent"),
      socialClass: "mixed",
      role: String(character?.role ?? "角色"),
      location: String(character?.location ?? "未知地点"),
    },
    traits: {
      ambition: toNumberOr(canonicalProjection.ambition ?? rawTraits.ambition, 0, -1, 1),
      prudence: toNumberOr(canonicalProjection.prudence ?? rawTraits.prudence, 0, -1, 1),
      impulsiveness: toNumberOr(canonicalProjection.impulsiveness ?? rawTraits.impulsiveness, 0, -1, 1),
      empathy: toNumberOr(canonicalProjection.empathy ?? rawTraits.empathy, 0, -1, 1),
      pride: toNumberOr(canonicalProjection.pride ?? rawTraits.pride, 0, -1, 1),
      loyalty: toNumberOr(canonicalProjection.loyalty ?? rawTraits.loyalty, 0, -1, 1),
      ruthlessness: toNumberOr(canonicalProjection.ruthlessness ?? rawTraits.ruthlessness, 0, -1, 1),
    },
    drives: {
      survival: toNumberOr(canonicalProjection.survival ?? rawDrives.survival, 0.5, 0, 1),
      power: toNumberOr(canonicalProjection.power ?? rawDrives.power, 0.5, 0, 1),
      status: toNumberOr(canonicalProjection.status ?? rawDrives.status, 0.5, 0, 1),
      wealth: toNumberOr(canonicalProjection.wealth ?? rawDrives.wealth, 0.5, 0, 1),
      belonging: toNumberOr(canonicalProjection.belonging ?? rawDrives.belonging, 0.5, 0, 1),
      morality: toNumberOr(canonicalProjection.morality ?? rawDrives.morality, 0.5, 0, 1),
      desire: toNumberOr(canonicalProjection.desire ?? rawDrives.desire, 0.5, 0, 1),
      revenge: toNumberOr(canonicalProjection.revenge ?? rawDrives.revenge, 0.5, 0, 1),
    },
    internalState: {
      mood: toNumberOr(canonicalProjection.mood ?? rawState.mood, 0, -1, 1),
      stress: toNumberOr(canonicalProjection.stress ?? rawState.stress, 0, -1, 1),
      fatigue: toNumberOr(canonicalProjection.fatigue ?? rawState.fatigue, 0.2, 0, 1),
      confidence: toNumberOr(canonicalProjection.confidence ?? rawState.confidence, 0, -1, 1),
    },
    beliefs: [],
    relations: relationMap[id] ?? {},
    resources: {
      money: Math.max(0, Number(canonicalProjection.money ?? rawResources.money ?? 0)),
      troops: Math.max(0, Number(canonicalProjection.troops ?? rawResources.troops ?? 0)),
      influence: toNumberOr(canonicalProjection.influence ?? rawResources.influence, 0.5, 0, 1),
      informationAccess: toNumberOr(
        canonicalProjection.information_access
          ?? canonicalProjection.informationAccess
          ?? rawResources.information_access
          ?? rawResources.informationAccess,
        0.5,
        0,
        1,
      ),
      time: Math.max(0, Number(canonicalProjection.time ?? rawResources.time ?? 1)),
    },
    profile: {
      hobbies: Array.isArray(character?.profile?.hobbies) ? character.profile.hobbies.slice(0, 6).map(String) : [],
      dislikes: Array.isArray(character?.profile?.dislikes) ? character.profile.dislikes.slice(0, 6).map(String) : [],
      family: String(character?.profile?.family ?? ""),
      hiddenWorry: String(character?.profile?.hidden_worry ?? character?.profile?.hiddenWorry ?? ""),
      habit: String(character?.profile?.habit ?? ""),
      privateGoal: String(character?.profile?.private_goal ?? character?.profile?.privateGoal ?? ""),
    },
    domain: {
      traits: domainTraits,
      states: domainStates,
      resources: domainResources,
      capabilities: {
        ...toObject(character?.capabilities),
        ...toObject(domainInput.capabilities),
      },
      relations: toObject(domainInput.relations),
      publicAxes: toObject(domainInput.publicAxes),
      extra: {
        ...toObject(domainInput.extra),
        driveAxes: {
          ...toObject(domainInput?.extra?.driveAxes),
          ...domainDriveAxes,
        },
        hints: {
          traits_hint: String(character?.traits_hint ?? ""),
          drives_hint: String(character?.drives_hint ?? ""),
        },
      },
    },
    memory: {
      episodic: [],
      semantic: [],
      strategic: [],
    },
  };
}

function buildWorldFromPack(worldPack, startContext, scenarioId, blueprint) {
  const characters = Array.isArray(worldPack?.characters) ? worldPack.characters : [];
  const normalizedIds = characters.map((item) => slugify(item?.id ?? item?.name, "agent"));
  const relationMap = buildRelationsMap(normalizedIds, Array.isArray(worldPack?.relations) ? worldPack.relations : []);

  const agents = characters.map((character, index) => {
    const normalized = {
      ...character,
      id: normalizedIds[index],
    };
    return toAgent(normalized, relationMap);
  });

  const locations = Array.from(new Set(agents.map((agent) => agent.identity.location).filter(Boolean)));
  const nodes = locations.length > 0 ? locations : ["主舞台"];
  const timelineNodes = Array.isArray(worldPack?.timeline_nodes) ? worldPack.timeline_nodes : [];
  const dayLabels = timelineNodes
    .sort((left, right) => Number(left?.order_index ?? 0) - Number(right?.order_index ?? 0))
    .slice(0, 24)
    .map((item) => String(item?.label ?? ""))
    .filter(Boolean);

  const extractedOpinion = normalizePublicOpinionSeed(startContext?.public_opinion);
  const fallbackOpinion = normalizePublicOpinionSeed(worldPack?.world?.public_axes ?? worldPack?.public_axes ?? {});
  const publicOpinion = Object.keys(extractedOpinion).length > 0
    ? extractedOpinion
    : Object.keys(fallbackOpinion).length > 0
      ? fallbackOpinion
      : {
          legitimacy: 0.5,
          alliance_pressure: 0.5,
          court_suspicion: 0.5,
          morale: 0.5,
        };

  return createWorldState({
    id: `custom-${scenarioId}`,
    title: String(worldPack?.world?.title ?? "自定义世界社会模拟"),
    time: { day: 1, phase: "morning", tick: 0 },
    space: {
      nodes,
      edges: [],
    },
    norms: {
      honorCulture: clamp01(worldPack?.world?.norms?.honor_culture, 0.5),
      hierarchyRigidity: clamp01(worldPack?.world?.norms?.hierarchy_rigidity, 0.5),
      punishmentForBetrayal: clamp01(worldPack?.world?.norms?.punishment_for_betrayal, 0.5),
      genderRestrictions: clamp01(worldPack?.world?.norms?.gender_restrictions, 0.5),
    },
    publicOpinion,
    metadata: {
      scenario: String(worldPack?.world?.title ?? "custom"),
      layer: "social-simulation-only",
      storyPhase: String(startContext?.story_phase ?? worldPack?.world?.setting_summary ?? ""),
      historyBrief: Array.isArray(startContext?.history_brief) ? startContext.history_brief.slice(0, 10).map(String) : [],
      timeline: {
        era: String(worldPack?.world?.title ?? "自定义世界"),
        startMonthIndex: 0,
        daysPerMonth: 30,
        dayLabels,
      },
      debug: { decisions: [] },
      relationFields: ["trust", "respect", "fear", "resentment", "obligation", "attraction"],
      characterSchema: toObject(worldPack?.character_schema),
      worldSchema: toObject(worldPack?.world_schema),
      publicAxesSchema: toObject(worldPack?.public_axes_schema),
      material: {
        glossary: toGlossary(worldPack?.material_glossary),
        fidelityRules: toStringList(worldPack?.fidelity_constraints ?? worldPack?.fidelity_rules, 20),
        focus: toStringList(startContext?.material_focus, 10),
      },
      bootstrapScenarioId: scenarioId,
      selectedTimelineNode: {
        id: String(startContext?.selected_timeline_node_id ?? ""),
        label: String(startContext?.selected_timeline_label ?? ""),
      },
      simulationBlueprint: blueprint,
    },
    agents,
    eventLog: [],
    sceneLog: [],
  });
}

export async function bootstrapWorldFromSources(config, options) {
  const sourceEntries = parseSourceFiles(options?.sourceFiles);
  if (sourceEntries.length === 0) {
    throw new Error("Bootstrap failed: no source files provided. Set SIM_SOURCE_FILES.");
  }

  const resolved = await resolveSourceFilePaths(sourceEntries);
  if (resolved.files.length === 0) {
    throw new Error(`Bootstrap failed: no readable source files. Skipped=${JSON.stringify(resolved.skipped)}`);
  }

  const files = await loadMaterials(resolved.files);
  const sourceSignature = buildSourceSignature(files);
  const db = createSimulationDatabase(config.dbPath);
  const requestedStartNode = String(options?.startNode ?? "").trim();

  if (config.bootstrapCacheEnabled !== false) {
    const cached = findCachedBootstrap(db, sourceSignature, requestedStartNode);
    if (cached) {
      return {
        world: cached.world,
        scenarioId: cached.scenarioId,
        sourceEntries,
        skippedEntries: resolved.skipped,
        sourceFiles: files.map((item) => item.path),
        sourceFileEncodings: files.map((item) => ({ path: item.path, encoding: item.encoding ?? "utf-8" })),
        selectedTimelineNode: cached.selectedTimelineNode,
        startNodeCandidates: cached.startNodeCandidates,
        ingestStats: null,
        fromCache: true,
      };
    }
  }

  const sourceDigest = buildSourceDigest(files);
  const materialSummary = await summarizeMaterial(config.llm, files);
  const ingestStats = summarizeMaterialCoverage(files, materialSummary.chunks, sourceDigest);
  const scenarioId = `scenario-${Date.now()}`;

  writeBootstrapArtifact(db, scenarioId, "source", "manifest", {
    sourceEntries,
    skippedEntries: resolved.skipped,
    files: files.map((item) => ({ path: item.path, chars: item.content.length, encoding: item.encoding ?? "utf-8" })),
    chunks: materialSummary.chunks.map((item) => ({ id: item.id, path: item.path, offset: item.offset, chars: item.text.length })),
    ingestStats,
  });

  writeBootstrapArtifact(db, scenarioId, "llm", "chunk_summaries", {
    summaries: materialSummary.summaries.map((item, idx) => ({
      chunk_id: materialSummary.chunks[idx]?.id,
      summary: item.summary,
      raw: item.raw,
      messages: item.messages,
    })),
  });

  const extracted = await extractWorldPack(config.llm, sourceDigest, materialSummary.summaries);
  writeBootstrapArtifact(db, scenarioId, "llm", "world_pack", {
    messages: extracted.messages,
    raw: extracted.raw,
    parsed: extracted.pack,
  });

  const blueprint = await designSimulationBlueprint(config.llm, extracted.pack);
  writeBootstrapArtifact(db, scenarioId, "llm", "simulation_blueprint", {
    messages: blueprint.messages,
    raw: blueprint.raw,
    parsed: blueprint.blueprint,
  });

  const resolvedStart = resolveStartNode(extracted.pack, options?.startNode ?? "");
  writeBootstrapArtifact(db, scenarioId, "result", "start_node_candidates", {
    requested: options?.startNode ?? "",
    resolved: resolvedStart.resolved,
    candidates: resolvedStart.candidates,
  });

  const startContext = await buildStartContext(config.llm, extracted.pack, resolvedStart.resolved);
  writeBootstrapArtifact(db, scenarioId, "llm", "start_context", {
    messages: startContext.messages,
    raw: startContext.raw,
    parsed: startContext.startContext,
  });

  const world = buildWorldFromPack(extracted.pack, startContext.startContext, scenarioId, blueprint.blueprint);
  writeBootstrapArtifact(db, scenarioId, "result", "world_seed", world);
  writeBootstrapArtifact(db, scenarioId, "result", "cache_meta", {
    source_signature: sourceSignature,
    requested_start_node: requestedStartNode,
    resolved_start_node: resolvedStart.resolved,
  });

  return {
    world,
    scenarioId,
    sourceEntries,
    skippedEntries: resolved.skipped,
    sourceFiles: files.map((item) => item.path),
    sourceFileEncodings: files.map((item) => ({ path: item.path, encoding: item.encoding ?? "utf-8" })),
    selectedTimelineNode: startContext.startContext?.selected_timeline_label || "",
    startNodeCandidates: resolvedStart.candidates,
    ingestStats,
    fromCache: false,
  };
}
