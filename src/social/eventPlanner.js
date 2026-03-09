import { requestJsonFromLLM } from "./llmClient.js";
import { parseJsonLenient } from "./jsonUtil.js";
import { timelineLabel } from "./timeLabel.js";

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
  const worldContext = {
    world: worldDigest(world),
    factions: factionDigest(world),
    agents: allAgentBriefs(world),
  };

  const messages = [
    {
      role: "system",
      content:
        "你是主事件规划器。基于世界状态，规划下一个自适应时间块（可是一日、一周、一个月甚至更久）及其关键事件。事件应自然发生，无则无，不必强求。必须保证时间线连续一致。只输出 JSON。",
    },
    ...chatHistory,
    {
      role: "user",
      content: [
        "输出 JSON: {\"time_block\":{\"amount\":3,\"unit\":\"day|week\",\"start_phase\":\"morning|day|night\",\"end_phase\":\"morning|day|night\",\"high_density\":false,\"reason\":\"...\"},\"events\":[{\"event_id\":\"e1\",\"title\":\"...\",\"summary\":\"...\",\"participant_ids\":[\"id\"],\"schedule\":{\"offset_days\":0,\"phase\":\"morning|day|night\"}}]}",
        "要求: 事件数 0~8；participant_ids 必须来自给定列表；允许私下事件（可仅1人）；允许输出空数组表示本时间块无大事。",
        "time_block 要求: 默认应在 2~7 天（或 1 周）范围自适应选择；仅在确有高密度连续关键事件时，才允许 1 天，并将 high_density 设为 true 且 reason 说明原因。",
        "规则: 若是公共/政治/军事事件，participant_ids 应尽量包含 2~5 名关键角色；仅在确属私下事件时可为 1 人。",
        "时间一致性: schedule.offset_days 必须落在 time_block 范围内，并与叙事因果一致。",
        "节奏: 有时平静、有时集中爆发，避免每个时间步都机械地产生大事件。",
        `participant_ids=${JSON.stringify(participantIds)}`,
        `context=${JSON.stringify(worldContext)}`,
      ].join("\n"),
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
    }));
  const relations = relationMatrix(world, participantIds);
  const relatedHistory = participantRecentEvents(world, participantIds);
  const worldContext = {
    timelineLabel: timelineLabel(world, world.time.day, world.time.phase),
    day: world.time.day,
    phase: world.time.phase,
    publicOpinion: world.publicOpinion,
    phaseBrief: world.metadata?.storyPhase ?? "",
  };

  const messages = [
    {
      role: "system",
      content:
        "你是次事件总结器。基于事件设定和多角色状态，给出事件总结、多角色互动张力与可见性。对话与互动长度按需要自然展开，不必强行冗长。只输出 JSON。",
    },
    {
      role: "user",
      content: [
        "输出 JSON: {\"event_summary\":\"...\",\"key_tensions\":[\"...\"],\"visibility\":0.0}",
        `event_plan=${JSON.stringify(eventPlan)}`,
        `world_context=${JSON.stringify(worldContext)}`,
        `participants=${JSON.stringify(participants)}`,
        `participant_relations=${JSON.stringify(relations)}`,
        `participant_related_history=${JSON.stringify(relatedHistory)}`,
      ].join("\n"),
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
