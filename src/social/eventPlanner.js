import { requestJsonFromLLM } from "./llmClient.js";
import { parseJsonLenient } from "./jsonUtil.js";
import { timelineLabel } from "./timeLabel.js";
import { resolvePromptLines, resolvePromptText } from "./framework.js";
import { buildMaterialConstraint } from "./materialContext.js";

const PHASES = ["morning", "day", "night"];

function toInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.trunc(num);
}

function normalizePhase(value, fallback = "morning") {
  const text = String(value ?? fallback).toLowerCase();
  if (PHASES.includes(text)) {
    return text;
  }
  return fallback;
}

function toBlockDays(amount, unit) {
  const safeAmount = Math.max(1, Math.min(12, toInt(amount, 1)));
  const normalizedUnit = String(unit ?? "day").toLowerCase();
  if (normalizedUnit === "week") {
    return safeAmount * 7;
  }
  if (normalizedUnit === "month") {
    return safeAmount * 7;
  }
  return safeAmount;
}

function normalizeTimeBlock(input) {
  const unit = ["day", "week", "month"].includes(String(input?.unit ?? "").toLowerCase())
    ? String(input.unit).toLowerCase()
    : "day";
  const highDensity = Boolean(input?.high_density);
  let amount = toInt(input?.amount, 3);
  if (unit === "day") {
    amount = Math.max(1, Math.min(7, amount));
    if (!highDensity) {
      amount = Math.max(2, amount);
    }
  } else if (unit === "week") {
    amount = 1;
  } else if (unit === "month") {
    amount = 1;
  }
  return {
    amount,
    unit,
    startPhase: normalizePhase(input?.start_phase, "morning"),
    endPhase: normalizePhase(input?.end_phase, "morning"),
    reason: String(input?.reason ?? ""),
    highDensity,
    days: toBlockDays(amount, unit),
  };
}

function normalizeSchedule(schedule, index, blockDays) {
  const maxOffset = Math.max(0, blockDays - 1);
  const fallbackOffset = Math.min(maxOffset, index);
  const rawOffset = toInt(schedule?.offset_days, fallbackOffset);
  return {
    offsetDays: Math.max(0, Math.min(maxOffset, rawOffset)),
    phase: normalizePhase(schedule?.phase, "day"),
  };
}

function worldDigest(world) {
  return {
    timelineLabel: timelineLabel(world, world.time.day, world.time.phase),
    day: world.time.day,
    phase: world.time.phase,
    publicOpinion: world.publicOpinion,
    norms: world.norms,
    phaseBrief: world.metadata?.storyPhase ?? "",
    historyBrief: world.metadata?.historyBrief ?? [],
    recentEvents: world.eventLog.slice(-6).map((e) => ({
      timelineLabel: timelineLabel(world, e.day, e.phase),
      day: e.day,
      phase: e.phase,
      actor: e.actor,
      summary: e.description,
    })),
  };
}

function factionDigest(world) {
  const result = {};
  for (const agent of Object.values(world.agents)) {
    const faction = agent.identity.faction;
    if (!result[faction]) {
      result[faction] = { members: 0, troops: 0, influence: 0, avgStress: 0 };
    }
    result[faction].members += 1;
    result[faction].troops += agent.resources.troops;
    result[faction].influence += agent.resources.influence;
    result[faction].avgStress += agent.internalState.stress;
  }
  for (const faction of Object.keys(result)) {
    const members = result[faction].members || 1;
    result[faction].influence = Number((result[faction].influence / members).toFixed(2));
    result[faction].avgStress = Number((result[faction].avgStress / members).toFixed(2));
  }
  return result;
}

function allAgentBriefs(world) {
  return Object.values(world.agents).map((agent) => ({
    id: agent.id,
    name: agent.name,
    faction: agent.identity.faction,
    role: agent.identity.role,
    location: agent.identity.location,
    state: {
      mood: agent.internalState.mood,
      stress: agent.internalState.stress,
      confidence: agent.internalState.confidence,
    },
    resources: {
      troops: agent.resources.troops,
      influence: agent.resources.influence,
      info: agent.resources.informationAccess,
    },
    profile: {
      hiddenWorry: agent.profile?.hiddenWorry ?? "",
      privateGoal: agent.profile?.privateGoal ?? "",
    },
    domain: agent.domain ?? {},
    keyRelations: Object.entries(agent.relations)
      .map(([otherId, relation]) => ({
        id: otherId,
        trust: relation.trust,
        fear: relation.fear,
        resentment: relation.resentment,
      }))
      .sort((a, b) => (
        Math.abs(b.trust) + Math.abs(b.fear) + Math.abs(b.resentment)
      ) - (
        Math.abs(a.trust) + Math.abs(a.fear) + Math.abs(a.resentment)
      ))
      .slice(0, 3),
  }));
}

function relationMatrix(world, participantIds) {
  const matrix = [];
  for (const fromId of participantIds) {
    const from = world.agents[fromId];
    if (!from) {
      continue;
    }
    for (const toId of participantIds) {
      if (toId === fromId) {
        continue;
      }
      const relation = from.relations[toId];
      if (!relation) {
        continue;
      }
      matrix.push({
        fromId,
        toId,
        trust: relation.trust,
        respect: relation.respect,
        fear: relation.fear,
        resentment: relation.resentment,
        obligation: relation.obligation,
      });
    }
  }
  return matrix;
}

function participantRecentEvents(world, participantIds) {
  const names = new Set(
    participantIds
      .map((id) => world.agents[id]?.name)
      .filter(Boolean),
  );
  return world.eventLog
    .slice(-12)
    .filter((event) => {
      if (event.participants?.some((id) => participantIds.includes(id))) {
        return true;
      }
      return names.has(event.actor);
    })
    .map((event) => ({
      timelineLabel: timelineLabel(world, event.day, event.phase),
      day: event.day,
      phase: event.phase,
      actor: event.actor,
      summary: event.description,
      participants: event.participants ?? [],
    }));
}

export async function planMainEvents(world, llmConfig, chatHistory = []) {
  const participantIds = Object.keys(world.agents);
  const framework = llmConfig.framework ?? {};
  const worldContext = {
    world: worldDigest(world),
    factions: factionDigest(world),
    agents: allAgentBriefs(world),
    schemas: {
      character: world.metadata?.characterSchema ?? {},
      world: world.metadata?.worldSchema ?? {},
      publicAxes: world.metadata?.publicAxesSchema ?? {},
    },
  };

  const frameworkConstraint = JSON.stringify({
    world_assumptions: framework.world_assumptions ?? {},
    style: framework.style ?? {},
    main_event_directives: framework.prompt_directives?.main_event ?? [],
  });
  const mainVars = {
    frameworkConstraint,
    materialConstraint: buildMaterialConstraint(world),
    participantIds: JSON.stringify(participantIds),
    worldContext: JSON.stringify(worldContext),
  };

  const messages = [
    {
      role: "system",
      content: resolvePromptText(framework, "prompts.main_event.system", mainVars),
    },
    ...chatHistory,
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.main_event.user_lines", mainVars).join("\n"),
    },
  ];

  const raw = await requestJsonFromLLM(llmConfig, messages);
  const parsed = parseJsonLenient(raw);
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  const timeBlock = normalizeTimeBlock(parsed?.time_block ?? {});
  const validIds = new Set(participantIds);
  const normalized = events
    .slice(0, 8)
    .map((event, index) => ({
      eventId: String(event?.event_id ?? `event-${index + 1}`),
      title: String(event?.title ?? "临时事件"),
      summary: String(event?.summary ?? ""),
      participantIds: (Array.isArray(event?.participant_ids) ? event.participant_ids : [])
        .filter((id) => validIds.has(id)),
      schedule: normalizeSchedule(event?.schedule ?? {}, index, timeBlock.days),
    }))
    .filter((event) => event.participantIds.length > 0);

  return { messages, raw, plan: { timeBlock, events: normalized } };
}

export async function summarizeSubEvent(world, eventPlan, llmConfig) {
  const framework = llmConfig.framework ?? {};
  const participantIds = Array.from(new Set(eventPlan.participantIds)).slice(0, 8);
  const participants = eventPlan.participantIds
    .map((id) => world.agents[id])
    .filter(Boolean)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      faction: agent.identity.faction,
      role: agent.identity.role,
      location: agent.identity.location,
      state: agent.internalState,
      drives: agent.drives,
      beliefs: agent.beliefs.slice(-3),
      profile: agent.profile,
      domain: agent.domain ?? {},
    }));
  const relations = relationMatrix(world, participantIds);
  const relatedHistory = participantRecentEvents(world, participantIds);
  const worldContext = {
    timelineLabel: timelineLabel(world, world.time.day, world.time.phase),
    day: world.time.day,
    phase: world.time.phase,
    publicOpinion: world.publicOpinion,
    phaseBrief: world.metadata?.storyPhase ?? "",
    schemas: {
      character: world.metadata?.characterSchema ?? {},
      world: world.metadata?.worldSchema ?? {},
      publicAxes: world.metadata?.publicAxesSchema ?? {},
    },
  };

  const frameworkConstraint = JSON.stringify({
    world_assumptions: framework.world_assumptions ?? {},
    style: framework.style ?? {},
    sub_event_directives: framework.prompt_directives?.sub_event ?? [],
  });
  const subVars = {
    eventPlan: JSON.stringify(eventPlan),
    worldContext: JSON.stringify(worldContext),
    participants: JSON.stringify(participants),
    relations: JSON.stringify(relations),
    relatedHistory: JSON.stringify(relatedHistory),
    frameworkConstraint,
    materialConstraint: buildMaterialConstraint(world),
  };

  const messages = [
    {
      role: "system",
      content: resolvePromptText(framework, "prompts.sub_event.system", subVars),
    },
    {
      role: "user",
      content: resolvePromptLines(framework, "prompts.sub_event.user_lines", subVars).join("\n"),
    },
  ];

  const raw = await requestJsonFromLLM(llmConfig, messages);
  const parsed = parseJsonLenient(raw) ?? {};
  return {
    messages,
    raw,
    summary: {
      eventSummary: String(parsed?.event_summary ?? eventPlan.summary ?? ""),
      keyTensions: Array.isArray(parsed?.key_tensions) ? parsed.key_tensions.map(String).slice(0, 5) : [],
      visibility: Math.max(0, Math.min(1, Number(parsed?.visibility ?? 0.6))),
    },
  };
}
