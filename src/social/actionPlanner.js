import { requestJsonFromLLM } from "./llmClient.js";
import { writeLlmTrace } from "./llmTrace.js";
import { parseJsonLenient } from "./jsonUtil.js";
import { timelineLabel } from "./timeLabel.js";
import { resolvePromptLines, resolvePromptText } from "./framework.js";
import { buildMaterialConstraint } from "./materialContext.js";

const ACTION_SCHEMA = [
  "返回 JSON 对象，字段:",
  "action_label:string",
  "target_ids:string[]",
  "participant_ids:string[]",
  "speech:string",
  "actions:[{type:string,description:string,target_ids:string[],visibility:number,impact:string}]",
  "dialogue:[{speaker_id:string,text:string,tone:string,target_ids:string[]}]",
  "summary:string",
  "rationale:string",
  "subjective_situation:{overall:string,threat:string,opportunity:string,certainty:number,bias:string}",
  "visibility:number",
  "drivers:[{factor:string,weight:number,evidence:string}]",
  "state_updates:{",
  "relation_updates:[{from,to,trust_delta,respect_delta,fear_delta,resentment_delta,obligation_delta,attraction_delta}],",
  "internal_updates:[{id,mood_delta,stress_delta,fatigue_delta,confidence_delta}],",
  "resource_updates:[{id,money_delta,troops_delta,influence_delta,information_access_delta,time_delta}],",
  "belief_updates:[{id,topic,stance,confidence}],",
  "public_opinion_updates:{<axis>_delta:number,...},",
  "domain_updates:[{id:string,container:string,key:string,mode:string,delta:number,value:any}]",
  "}",
].join(" ");

function firstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizePotentialJson(text) {
  return text
    .replaceAll("“", "\"")
    .replaceAll("”", "\"")
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseActionJson(rawText) {
  const stripped = stripCodeFence(rawText);
  const parsed = parseJsonLenient(stripped);
  if (parsed) {
    return parsed;
  }
  const objectText = firstJsonObject(stripped);
  if (!objectText) {
    return null;
  }
  return parseJsonLenient(normalizePotentialJson(objectText));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function clampDelta(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return round2(clamp(value, -0.25, 0.25));
}

function normalizeList(input) {
  return Array.isArray(input) ? input : [];
}

function normalizeOpinionKey(key) {
  return String(key ?? "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function sanitizeOpinionUpdates(input) {
  const output = {};
  if (!input || typeof input !== "object") {
    return output;
  }
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeOpinionKey(rawKey);
    if (!key) {
      continue;
    }
    output[key] = clampDelta(Number(rawValue ?? 0));
  }
  return output;
}

function sanitizeAction(world, actorId, action) {
  const agentIds = new Set(Object.keys(world.agents));
  const targetIds = normalizeList(action.target_ids).filter((id) => agentIds.has(id) && id !== actorId);
  const participantIds = normalizeList(action.participant_ids).filter((id) => agentIds.has(id) && id !== actorId);
  const actions = normalizeList(action.actions)
    .slice(0, 8)
    .map((item) => ({
      type: String(item?.type ?? "generic_action"),
      description: String(item?.description ?? ""),
      targetIds: normalizeList(item?.target_ids).filter((id) => agentIds.has(id) && id !== actorId).slice(0, 6),
      visibility: round2(clamp(Number(item?.visibility ?? 0.6), 0, 1)),
      impact: String(item?.impact ?? ""),
    }))
    .filter((item) => item.description);
  const dialogue = normalizeList(action.dialogue)
    .slice(0, 12)
    .map((turn) => ({
      speakerId: agentIds.has(turn?.speaker_id) ? String(turn.speaker_id) : actorId,
      text: String(turn?.text ?? ""),
      tone: String(turn?.tone ?? ""),
      targetIds: normalizeList(turn?.target_ids).filter((id) => agentIds.has(id) && id !== actorId).slice(0, 6),
    }))
    .filter((turn) => turn.text);
  const drivers = normalizeList(action.drivers)
    .slice(0, 5)
    .map((driver) => ({
      factor: String(driver?.factor ?? ""),
      weight: clampDelta(Number(driver?.weight ?? 0)),
      evidence: String(driver?.evidence ?? ""),
    }));

  const relationUpdates = normalizeList(action?.state_updates?.relation_updates)
    .filter((item) => agentIds.has(item?.from) && agentIds.has(item?.to))
    .slice(0, 16)
    .map((item) => ({
      from: item.from,
      to: item.to,
      trust_delta: clampDelta(Number(item.trust_delta ?? 0)),
      respect_delta: clampDelta(Number(item.respect_delta ?? 0)),
      fear_delta: clampDelta(Number(item.fear_delta ?? 0)),
      resentment_delta: clampDelta(Number(item.resentment_delta ?? 0)),
      obligation_delta: clampDelta(Number(item.obligation_delta ?? 0)),
      attraction_delta: clampDelta(Number(item.attraction_delta ?? 0)),
    }));

  const internalUpdates = normalizeList(action?.state_updates?.internal_updates)
    .filter((item) => agentIds.has(item?.id))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      mood_delta: clampDelta(Number(item.mood_delta ?? 0)),
      stress_delta: clampDelta(Number(item.stress_delta ?? 0)),
      fatigue_delta: clampDelta(Number(item.fatigue_delta ?? 0)),
      confidence_delta: clampDelta(Number(item.confidence_delta ?? 0)),
    }));

  const resourceUpdates = normalizeList(action?.state_updates?.resource_updates)
    .filter((item) => agentIds.has(item?.id))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      money_delta: clampDelta(Number(item.money_delta ?? 0)) * 120,
      troops_delta: clampDelta(Number(item.troops_delta ?? 0)) * 8000,
      influence_delta: clampDelta(Number(item.influence_delta ?? 0)),
      information_access_delta: clampDelta(Number(item.information_access_delta ?? 0)),
      time_delta: clampDelta(Number(item.time_delta ?? 0)),
    }));

  const beliefUpdates = normalizeList(action?.state_updates?.belief_updates)
    .filter((item) => agentIds.has(item?.id))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      topic: String(item.topic ?? ""),
      stance: String(item.stance ?? ""),
      confidence: clamp(Number(item.confidence ?? 0.5), 0, 1),
    }));

  const opinion = action?.state_updates?.public_opinion_updates ?? {};
  const publicOpinionUpdates = sanitizeOpinionUpdates(opinion);

  const domainUpdates = normalizeList(action?.state_updates?.domain_updates)
    .filter((item) => agentIds.has(item?.id))
    .slice(0, 20)
    .map((item) => ({
      id: String(item.id),
      container: String(item.container ?? "extra").trim() || "extra",
      key: String(item.key ?? "").trim(),
      mode: String(item.mode ?? (item.value !== undefined ? "set" : "delta")).toLowerCase(),
      delta: Number.isFinite(Number(item.delta)) ? clampDelta(Number(item.delta)) : 0,
      value: item?.value,
    }))
    .filter((item) => item.key);

  return {
    actionLabel: String(action.action_label ?? "行动"),
    targetIds,
    participantIds,
    speech: String(action.speech ?? ""),
    actions,
    dialogue,
    summary: String(action.summary ?? ""),
    rationale: String(action.rationale ?? ""),
    subjectiveSituation: {
      overall: String(action?.subjective_situation?.overall ?? ""),
      threat: String(action?.subjective_situation?.threat ?? ""),
      opportunity: String(action?.subjective_situation?.opportunity ?? ""),
      certainty: round2(clamp(Number(action?.subjective_situation?.certainty ?? 0.5), 0, 1)),
      bias: String(action?.subjective_situation?.bias ?? ""),
    },
    visibility: round2(clamp(Number(action?.visibility ?? 0.6), 0, 1)),
    drivers,
    stateUpdates: {
      relationUpdates,
      internalUpdates,
      resourceUpdates,
      beliefUpdates,
      publicOpinionUpdates,
      domainUpdates,
    },
  };
}

function buildRollingHistory(world, llmConfig) {
  const day = Number(world.time.day ?? 1);
  const days = Number(llmConfig?.historyBriefDays ?? 2);
  const maxItems = Number(llmConfig?.historyBriefMaxItems ?? 8);
  const minDay = Math.max(1, day - days + 1);

  const dynamicItems = world.eventLog
    .filter((event) => Number(event.day ?? 0) >= minDay)
    .slice(-maxItems)
    .map((event) => `${timelineLabel(world, event.day, event.phase)}:${event.actor}${event.description ? `-${event.description}` : ""}`);

  if (dynamicItems.length > 0) {
    return dynamicItems;
  }
  return (world.metadata?.historyBrief ?? []).slice(0, maxItems);
}

function buildWorldDigest(world, llmConfig) {
  const phaseEvents = world.eventLog
    .filter((event) => event.day === world.time.day && event.phase === world.time.phase)
    .slice(-4)
    .map((event) => ({ actor: event.actor, summary: event.description }));

  return {
    timeline_label: timelineLabel(world, world.time.day, world.time.phase),
    day: world.time.day,
    phase: world.time.phase,
    opinion: world.publicOpinion,
    public_axes_schema: world.metadata?.publicAxesSchema ?? {},
    character_schema: world.metadata?.characterSchema ?? {},
    world_schema: world.metadata?.worldSchema ?? {},
    phase_brief: world.metadata?.storyPhase ?? "",
    history_brief: buildRollingHistory(world, llmConfig),
    recent_events: world.eventLog.slice(-2).map((event) => ({
      actor: event.actor,
      summary: event.description,
    })),
    phase_events: phaseEvents,
  };
}

function relationScore(relation = {}) {
  return Math.abs(relation.trust ?? 0)
    + Math.abs(relation.fear ?? 0)
    + Math.abs(relation.resentment ?? 0)
    + Math.abs(relation.obligation ?? 0);
}

function buildActorDigest(world, actorId, candidateIds = []) {
  const actor = world.agents[actorId];
  const keyRelations = candidateIds
    .map((id) => ({
      id,
      name: world.agents[id]?.name ?? id,
      trust: actor.relations[id]?.trust ?? 0,
      respect: actor.relations[id]?.respect ?? 0,
      fear: actor.relations[id]?.fear ?? 0,
      resentment: actor.relations[id]?.resentment ?? 0,
      obligation: actor.relations[id]?.obligation ?? 0,
    }))
    .filter((item) => relationScore(item) > 0.12)
    .sort((left, right) => relationScore(right) - relationScore(left))
    .slice(0, 4);

  return {
    id: actor.id,
    name: actor.name,
    faction: actor.identity.faction,
    role: actor.identity.role,
    location: actor.identity.location,
    traits: actor.traits,
    drives: actor.drives,
    state: actor.internalState,
    resources: actor.resources,
    domain: actor.domain ?? {},
    profile: {
      hobbies: actor.profile?.hobbies ?? [],
      dislikes: actor.profile?.dislikes ?? [],
      family: actor.profile?.family ?? "",
      hidden_worry: actor.profile?.hiddenWorry ?? "",
      habit: actor.profile?.habit ?? "",
      private_goal: actor.profile?.privateGoal ?? "",
      current_feelings: {
        mood: actor.internalState?.mood ?? 0,
        stress: actor.internalState?.stress ?? 0,
        confidence: actor.internalState?.confidence ?? 0,
      },
    },
    beliefs: actor.beliefs.slice(-2),
    key_relations: keyRelations,
    memory_recent: actor.memory.episodic.slice(-2),
    subjective_recent: (actor.memory.semantic ?? []).slice(-2),
  };
}

function buildCandidateIds(world, actorId, planningContext = {}) {
  const actor = world.agents[actorId];
  const sameLocationIds = (planningContext.locationIndex?.[actor.identity.location] ?? []).filter((id) => id !== actorId);
  const recentActorIds = (planningContext.recentActorIds ?? []).filter((id) => id !== actorId);
  const factionLeaderId = planningContext.factionLeaders?.[actor.identity.faction];
  const topRelationIds = Object.entries(actor.relations ?? {})
    .map(([id, relation]) => ({ id, score: relationScore(relation) }))
    .filter((item) => item.score > 0.1)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.id);

  const candidateIds = Array.from(new Set([...sameLocationIds, ...recentActorIds, factionLeaderId, ...topRelationIds]))
    .filter((id) => id && id !== actorId)
    .slice(0, 8);
  return candidateIds;
}

export function buildActionPromptMessages(world, actorId, randomSignal, planningContext = {}) {
  const actor = world.agents[actorId];
  const llmConfig = planningContext.llmConfig ?? {};
  const framework = llmConfig.framework ?? {};
  const worldDigest = buildWorldDigest(world, llmConfig);
  const candidateIds = buildCandidateIds(world, actorId, planningContext);
  const actorDigest = buildActorDigest(world, actorId, candidateIds);
  const localPeople = candidateIds.map((id) => {
    const person = world.agents[id];
    const relation = actor.relations[id] ?? {};
    return {
      id: person.id,
      name: person.name,
      faction: person.identity.faction,
      role: person.identity.role,
      relation: {
        trust: relation.trust ?? 0,
        respect: relation.respect ?? 0,
        fear: relation.fear ?? 0,
        resentment: relation.resentment ?? 0,
        obligation: relation.obligation ?? 0,
      },
      domain: person.domain ?? {},
    };
  });

  const frameworkConstraint = JSON.stringify({
    world_assumptions: framework.world_assumptions ?? {},
    style: framework.style ?? {},
    action_directives: framework.prompt_directives?.action ?? [],
  });
  const vars = {
    speechMaxChars: llmConfig.speechMaxChars ?? 80,
    summaryMaxChars: llmConfig.summaryMaxChars ?? 120,
    rationaleMaxChars: llmConfig.rationaleMaxChars ?? 160,
    frameworkConstraint,
    materialConstraint: buildMaterialConstraint(world),
    randomSignal,
    actorName: actor.name,
    worldDigest: JSON.stringify(worldDigest),
    actorDigest: JSON.stringify(actorDigest),
    localPeople: JSON.stringify(localPeople),
    currentEvent: JSON.stringify(planningContext.currentEvent ?? {}),
    ACTION_SCHEMA,
  };

  return [
    {
      role: "system",
      content: resolvePromptText(framework, "prompts.action.system", vars),
    },
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.action.user_lines", vars).join("\n"),
    },
  ];
}

export async function planActionWithLLM(world, actorId, llmConfig, planningContext = {}) {
  const randomFn = planningContext.randomFn ?? Math.random;
  const randomSignal = randomFn().toFixed(4);
  const baseMessages = buildActionPromptMessages(world, actorId, randomSignal, {
    ...planningContext,
    llmConfig,
  });
  const actor = world.agents[actorId];

  let lastRaw = "";
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = [...baseMessages];
    if (attempt === 1) {
      messages.push({
        role: "user",
        content: resolvePromptText(llmConfig.framework ?? {}, "prompts.action.retry_user"),
      });
    }

    try {
      const requestConfig = { ...llmConfig };
      if (attempt === 1) {
        requestConfig.maxTokens = Math.max(llmConfig.maxTokens, 700);
      }
      lastRaw = await requestJsonFromLLM(requestConfig, messages);
      const parsed = parseActionJson(lastRaw);
      if (parsed) {
        if (llmConfig.traceEnabled) {
          await writeLlmTrace({
            traceDir: llmConfig.traceRunDir,
            actorId,
            actorName: actor.name,
            tick: world.time.tick,
            day: world.time.day,
            phase: world.time.phase,
            attempt: attempt + 1,
            status: "ok",
            messages,
            rawOutput: lastRaw,
          });
        }
        return sanitizeAction(world, actorId, parsed);
      }
      lastError = "JSON_PARSE_FAILED";
      if (llmConfig.traceEnabled) {
        await writeLlmTrace({
          traceDir: llmConfig.traceRunDir,
          actorId,
          actorName: actor.name,
          tick: world.time.tick,
          day: world.time.day,
          phase: world.time.phase,
          attempt: attempt + 1,
          status: "json_parse_failed",
          error: lastError,
          messages,
          rawOutput: lastRaw,
        });
      }
    } catch (error) {
      lastError = String(error?.message ?? error);
      if (llmConfig.traceEnabled) {
        await writeLlmTrace({
          traceDir: llmConfig.traceRunDir,
          actorId,
          actorName: actor.name,
          tick: world.time.tick,
          day: world.time.day,
          phase: world.time.phase,
          attempt: attempt + 1,
          status: "request_error",
          error: lastError,
          messages,
          rawOutput: lastRaw,
        });
      }
    }
  }

  return buildFallbackAction(world, actorId, `${lastError}\n${lastRaw}`.trim());
}

function buildFallbackAction(world, actorId, raw) {
  const actor = world.agents[actorId];
  const rawText = String(raw);
  const truncated = /LLM_OUTPUT_TRUNCATED|finish_reason|Unexpected end of JSON input/i.test(rawText);
  const timeoutOrAbort = /LLM_TIMEOUT_ABORTED|This operation was aborted|AbortError/i.test(rawText);
  const authError = /LLM_HTTP_401|invalid_authentication/i.test(rawText);
  const jsonError = /JSON_PARSE_FAILED|Unexpected token|Expected ','|invalid json/i.test(rawText);
  let reasonTitle = "LLM请求异常";
  let reasonEvidence = "上游服务不可用或超时";
  if (truncated) {
    reasonTitle = "LLM输出被截断";
    reasonEvidence = "max_tokens 不足或输出过长";
  } else if (timeoutOrAbort) {
    reasonTitle = "LLM请求超时/中断";
    reasonEvidence = "网络耗时或并发压力导致中断";
  } else if (authError) {
    reasonTitle = "LLM鉴权失败";
    reasonEvidence = "API Key 或 endpoint 配置无效";
  } else if (jsonError) {
    reasonTitle = "LLM输出JSON不合法";
    reasonEvidence = "模型输出未满足结构约束";
  }
  const targetId = Object.keys(actor.relations)
    .sort((left, right) => (actor.relations[right]?.trust ?? 0) - (actor.relations[left]?.trust ?? 0))[0];
  return {
    actionLabel: "fallback_consult",
    targetIds: targetId ? [targetId] : [],
    participantIds: targetId ? [targetId] : [],
    speech: `${actor.name}：先稳住局势，补充情报后再决断。`,
    actions: [
      {
        type: "private_reflection",
        description: `${actor.name}暂缓公开动作，优先核对情报与部署。`,
        targetIds: targetId ? [targetId] : [],
        visibility: 0.3,
        impact: "维持局势稳定，减少误判风险。",
      },
    ],
    dialogue: targetId
      ? [{
          speakerId: actorId,
          text: `${actor.name}：先稳住局势，补充情报后再决断。`,
          tone: "谨慎",
          targetIds: [targetId],
        }]
      : [],
    summary: `${actor.name}暂时保持谨慎，优先整理信息并与关键对象核对事实。`,
    rationale: `${reasonTitle}，使用兜底动作继续模拟。原始片段: ${rawText.slice(0, 120)}`,
    subjectiveSituation: {
      overall: "信息不完整，先观测再决策。",
      threat: "关键信息缺口仍在。",
      opportunity: "通过低风险沟通补齐认知。",
      certainty: 0.35,
      bias: "谨慎偏置",
    },
    drivers: [{ factor: "容错机制", weight: 1, evidence: reasonEvidence }],
    stateUpdates: {
      relationUpdates: targetId
        ? [{
            from: actorId,
            to: targetId,
            trust_delta: 0.02,
            respect_delta: 0.01,
            fear_delta: 0,
            resentment_delta: 0,
            obligation_delta: 0.01,
            attraction_delta: 0,
          }]
        : [],
      internalUpdates: [{ id: actorId, mood_delta: -0.01, stress_delta: -0.02, fatigue_delta: 0.01, confidence_delta: -0.01 }],
      resourceUpdates: [],
      beliefUpdates: [],
      publicOpinionUpdates: {
        court_suspicion_delta: 0.01,
      },
      domainUpdates: [],
    },
  };
}
