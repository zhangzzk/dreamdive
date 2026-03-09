import { clamp } from "./model.js";
import { adviseGoalByLLM, adviseGoalByPersona } from "./llmAdvisor.js";

export function decideAgentAction(world, agentId, perceptions) {
  const agent = world.agents[agentId];
  const { scores, features } = computeRuleScores(world, agent, perceptions);

  const advice = adviseGoalByPersona(world, agent, perceptions);
  const mode = "hybrid";
  const result = resolveDecision(world, agent, agentId, scores, features, advice, mode);
  return result;
}

export async function decideAgentActionAsync(world, agentId, perceptions, options = {}) {
  const agent = world.agents[agentId];
  const { scores, features } = computeRuleScores(world, agent, perceptions);
  const fallbackAdvice = adviseGoalByPersona(world, agent, perceptions);
  const llmAdvice = options.enableLLM
    ? await adviseGoalByLLM(world, agent, perceptions, options.llm)
    : null;
  const advice = llmAdvice ?? fallbackAdvice;
  const mode = llmAdvice ? "hybrid+llm" : "hybrid";
  const result = resolveDecision(world, agent, agentId, scores, features, advice, mode);
  return result;
}

function resolveDecision(world, agent, agentId, scores, features, advice, mode) {
  const blendWeight = advice.confidence;
  const blendedScores = blendScores(scores, advice.scores, blendWeight);
  const ranked = Object.entries(blendedScores).sort((left, right) => right[1] - left[1]);
  const [goal, topScore] = ranked[0];
  const resolvedGoal = topScore < 0.2 ? "observe" : goal;
  const topDrivers = inferTopDrivers(features, resolvedGoal);
  agent.currentGoal = resolvedGoal;
  agent.lastDecision = {
    tick: world.time.tick,
    mode,
    ruleScores: roundScores(scores),
    advisorScores: roundScores(advice.scores),
    blendedScores: roundScores(blendedScores),
    rationale: advice.rationale,
    topDrivers,
  };

  const action = buildActionFromGoal(world, agentId, resolvedGoal, blendedScores);
  return {
    goal: resolvedGoal,
    action,
    debug: {
      mode,
      topDrivers,
      rationale: advice.rationale,
      blendedScores: roundScores(blendedScores),
      utterance: action?.utterance ?? "",
      advisorSource: mode === "hybrid+llm" ? "llm" : "local",
    },
  };
}

function computeRuleScores(world, agent, perceptions) {
  const playerId = world.metadata.playerId;
  const playerTrust = agent.relations[playerId]?.trust ?? 0;
  const strongestResentment = maxRelationValue(agent.relations, "resentment");
  const rumorBeliefConfidence = mean(
    agent.beliefs
      .filter((belief) => belief.topic === "联刘抗曹")
      .map((belief) => belief.confidence),
  );
  const recentRumorPressure = perceptions.recentEvents.filter((event) => event.type === "rumor").length * 0.08;

  const scores = {
    form_alliance:
      0.35 * agent.drives.power +
      0.2 * agent.traits.ambition +
      0.18 * agent.traits.loyalty +
      0.18 * (world.publicOpinion.alliancePressure ?? 0) +
      0.08 * agent.traits.prudence -
      0.22 * agent.internalState.stress -
      0.18 * agent.internalState.fatigue,
    spread_rumor:
      0.3 * agent.traits.ruthlessness +
      0.45 * Math.max(0, -playerTrust) +
      0.2 * (world.publicOpinion.courtSuspicion ?? 0) +
      0.15 * strongestResentment +
      0.15 * rumorBeliefConfidence +
      recentRumorPressure -
      0.08 * agent.traits.empathy,
    challenge_rival:
      0.35 * agent.traits.pride +
      0.25 * agent.drives.status +
      0.2 * strongestResentment -
      0.15 * agent.traits.prudence +
      0.12 * agent.internalState.stress +
      0.08 * (world.publicOpinion.courtSuspicion ?? 0),
    observe:
      0.08 +
      0.12 * agent.traits.prudence +
      0.2 * agent.internalState.fatigue -
      0.08 * agent.drives.power -
      0.06 * agent.traits.ambition,
  };
  return {
    scores,
    features: {
      playerTrust,
      strongestResentment,
      rumorBeliefConfidence,
      recentRumorPressure,
      alliancePressure: world.publicOpinion.alliancePressure ?? 0,
      courtSuspicion: world.publicOpinion.courtSuspicion ?? 0,
      pride: agent.traits.pride,
      ambition: agent.traits.ambition,
      prudence: agent.traits.prudence,
      fatigue: agent.internalState.fatigue,
      stress: agent.internalState.stress,
      powerDrive: agent.drives.power,
      statusDrive: agent.drives.status,
    },
  };
}

function buildActionFromGoal(world, agentId, goal, scores) {
  const agent = world.agents[agentId];
  const playerId = world.metadata.playerId;

  if (goal === "form_alliance") {
    const targetId = highestTrustTarget(agent, Object.keys(agent.relations).filter((id) => id !== playerId));
    if (!targetId) {
      return null;
    }
    return {
      type: "proposal",
      actorId: agentId,
      targetId,
      intensity: clamp(0.45 + scores.form_alliance * 0.5, 0, 1),
      utterance: `${agent.name}：当下局势紧迫，应尽快与${world.agents[targetId].name}统一行动。`,
    };
  }

  if (goal === "spread_rumor") {
    return {
      type: "rumor",
      actorId: agentId,
      targetId: playerId,
      subject: "联刘抗曹",
      intensity: clamp(0.35 + scores.spread_rumor * 0.6, 0, 1),
      utterance: `${agent.name}（低声）：此人言行未必可信，联刘之策恐有隐患。`,
    };
  }

  if (goal === "challenge_rival") {
    const targetId = lowestTrustTarget(agent, Object.keys(agent.relations));
    if (!targetId) {
      return null;
    }
    return {
      type: "debate",
      actorId: agentId,
      targetId,
      intensity: clamp(0.4 + scores.challenge_rival * 0.6, 0, 1),
      utterance: `${agent.name}：${world.agents[targetId].name}之议过于轻率，我不同意。`,
    };
  }

  return null;
}

function inferTopDrivers(features, goal) {
  const candidates = [];
  if (goal === "form_alliance") {
    candidates.push(["联盟压力", features.alliancePressure]);
    candidates.push(["权力动机", features.powerDrive]);
    candidates.push(["野心", features.ambition]);
    candidates.push(["谨慎", -features.prudence]);
  } else if (goal === "spread_rumor") {
    candidates.push(["对玩家不信任", Math.max(0, -features.playerTrust)]);
    candidates.push(["朝堂猜疑氛围", features.courtSuspicion]);
    candidates.push(["怨恨强度", features.strongestResentment]);
    candidates.push(["流言压力", features.recentRumorPressure]);
  } else if (goal === "challenge_rival") {
    candidates.push(["自尊", features.pride]);
    candidates.push(["地位动机", features.statusDrive]);
    candidates.push(["压力", features.stress]);
    candidates.push(["怨恨强度", features.strongestResentment]);
  } else {
    candidates.push(["疲劳", features.fatigue]);
    candidates.push(["谨慎", features.prudence]);
    candidates.push(["联盟压力不足", 1 - features.alliancePressure]);
    candidates.push(["权力动机不足", 1 - features.powerDrive]);
  }
  return candidates
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 3)
    .map(([name, value]) => ({ name, value: Number(value.toFixed(3)) }));
}

function highestTrustTarget(agent, candidates) {
  return candidates
    .filter((id) => agent.relations[id])
    .sort((left, right) => agent.relations[right].trust - agent.relations[left].trust)[0];
}

function lowestTrustTarget(agent, candidates) {
  return candidates
    .filter((id) => agent.relations[id])
    .sort((left, right) => agent.relations[left].trust - agent.relations[right].trust)[0];
}

function maxRelationValue(relations, key) {
  const values = Object.values(relations).map((relation) => relation[key] ?? 0);
  return values.length ? Math.max(...values) : 0;
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function blendScores(ruleScores, advisorScores, weight) {
  const result = {};
  for (const goal of Object.keys(ruleScores)) {
    const rule = ruleScores[goal] ?? 0;
    const advisor = advisorScores[goal] ?? 0;
    result[goal] = rule * (1 - weight) + advisor * weight;
  }
  return result;
}

function roundScores(scores) {
  return Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, Number(value.toFixed(3))]),
  );
}
