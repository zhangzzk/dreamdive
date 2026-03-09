import { cloneWorldState, clamp, validateWorldState } from "./model.js";
import { interpretEventsAsScenes } from "./narrative.js";
import { decideAgentAction, decideAgentActionAsync } from "./agentPolicy.js";

const PHASE_SEQUENCE = ["morning", "day", "night"];

export function runSimulation(world, steps = 1, options = {}) {
  let current = cloneWorldState(world);

  for (let index = 0; index < steps; index += 1) {
    current = simulateTick(current, options);
  }

  return current;
}

export async function runSimulationAsync(world, steps = 1, options = {}) {
  let current = cloneWorldState(world);

  for (let index = 0; index < steps; index += 1) {
    current = await simulateTickAsync(current, options);
  }

  return current;
}

export function runSimulationTimeline(world, steps = 1) {
  const snapshots = [cloneWorldState(world)];
  let current = cloneWorldState(world);

  for (let index = 0; index < steps; index += 1) {
    current = simulateTick(current);
    snapshots.push(cloneWorldState(current));
  }

  return snapshots;
}

export function simulateTick(world, options = {}) {
  validateWorldState(world);
  const next = cloneWorldState(world);
  const activeAgents = selectActiveAgents(next);
  const decisions = [];
  const debugRecords = [];

  for (const agentId of activeAgents) {
    const perceptions = perceptionUpdate(next, agentId);
    beliefUpdate(next, agentId, perceptions);
    const { action, debug } = decideAgentAction(next, agentId, perceptions);
    if (options.debug && debug) {
      debugRecords.push(buildDebugRecord(next, agentId, debug));
    }
    if (action) {
      decisions.push(action);
    }
  }

  const events = resolveActions(next, decisions);
  memoryUpdate(next, events);
  next.eventLog.push(...events);
  next.sceneLog.push(...interpretEventsAsScenes(events));
  if (options.debug) {
    appendDebugRecords(next, debugRecords);
  }
  advanceTime(next);
  validateWorldState(next);
  return next;
}

export async function simulateTickAsync(world, options = {}) {
  validateWorldState(world);
  const next = cloneWorldState(world);
  const activeAgents = selectActiveAgents(next);
  const decisions = [];
  const debugRecords = [];

  for (const agentId of activeAgents) {
    const perceptions = perceptionUpdate(next, agentId);
    beliefUpdate(next, agentId, perceptions);
    const { action, debug } = await decideAgentActionAsync(next, agentId, perceptions, options);
    if (options.debug && debug) {
      debugRecords.push(buildDebugRecord(next, agentId, debug));
    }
    if (action) {
      decisions.push(action);
    }
  }

  const events = resolveActions(next, decisions);
  memoryUpdate(next, events);
  next.eventLog.push(...events);
  next.sceneLog.push(...interpretEventsAsScenes(events));
  if (options.debug) {
    appendDebugRecords(next, debugRecords);
  }
  advanceTime(next);
  validateWorldState(next);
  return next;
}

function selectActiveAgents(world) {
  return Object.values(world.agents)
    .filter((agent) => agent.resources.time > 0 && agent.internalState.fatigue < 1)
    .map((agent) => agent.id);
}

function perceptionUpdate(world, agentId) {
  const agent = world.agents[agentId];
  const recentEvents = world.eventLog.slice(-4);
  const visibleAgents = Object.values(world.agents)
    .filter((other) => other.id !== agentId && other.identity.location === agent.identity.location)
    .map((other) => other.id);

  return {
    recentEvents,
    visibleAgents,
    publicOpinion: world.publicOpinion,
  };
}

function beliefUpdate(world, agentId, perceptions) {
  const agent = world.agents[agentId];
  const incomingRumors = perceptions.recentEvents.filter(
    (event) => event.type === "rumor" && event.participants.includes(agentId),
  );

  for (const rumor of incomingRumors) {
    agent.beliefs.push({
      topic: rumor.subject,
      stance: rumor.description,
      confidence: clamp(0.35 + agent.resources.informationAccess * 0.4, 0, 1),
      source: rumor.actor,
      tick: world.time.tick,
    });
  }
}

function resolveActions(world, actions) {
  const events = [];

  for (const action of actions) {
    const actor = world.agents[action.actorId];
    const target = world.agents[action.targetId];
    if (!actor || !target) {
      continue;
    }

    if (action.type === "proposal") {
      shiftRelation(world, action.actorId, action.targetId, "trust", 0.08 + action.intensity * 0.1);
      shiftRelation(world, action.targetId, action.actorId, "obligation", 0.06);
      world.publicOpinion.alliancePressure = clamp((world.publicOpinion.alliancePressure ?? 0) + 0.04, 0, 1);
      events.push(createEvent(world, action, {
        description: `${actor.name}劝说${target.name}尽快形成协同抗敌方案。`,
        participants: [action.actorId, action.targetId],
        visibility: 0.8,
        importance: 0.6 + action.intensity * 0.2,
        consequences: ["trust_up", "obligation_up"],
      }));
      continue;
    }

    if (action.type === "rumor") {
      const audienceIds = Object.keys(world.agents).filter(
        (agentId) => agentId !== action.actorId && agentId !== action.targetId,
      );
      for (const audienceId of audienceIds) {
        shiftRelation(world, audienceId, action.targetId, "trust", -0.08);
        shiftRelation(world, audienceId, action.targetId, "fear", 0.05);
      }
      shiftRelation(world, action.targetId, action.actorId, "trust", -0.12);
      shiftRelation(world, action.targetId, action.actorId, "fear", 0.08);
      world.publicOpinion.courtSuspicion = clamp((world.publicOpinion.courtSuspicion ?? 0) + 0.06, 0, 1);
      events.push(createEvent(world, action, {
        description: `${actor.name}散布“联盟是否明智、玩家是否可靠”的怀疑。`,
        participants: [action.actorId, action.targetId, ...audienceIds],
        visibility: 0.65,
        importance: 0.55 + action.intensity * 0.25,
        consequences: ["trust_down", "fear_up"],
      }));
      continue;
    }

    if (action.type === "debate") {
      shiftRelation(world, action.actorId, action.targetId, "respect", -0.06);
      shiftRelation(world, action.targetId, action.actorId, "resentment", 0.1);
      actor.internalState.stress = clamp(actor.internalState.stress + 0.08);
      target.internalState.stress = clamp(target.internalState.stress + 0.12);
      events.push(createEvent(world, action, {
        description: `${actor.name}在议事场合公开质疑${target.name}。`,
        participants: [action.actorId, action.targetId],
        visibility: 0.95,
        importance: 0.58 + action.intensity * 0.2,
        consequences: ["respect_down", "resentment_up", "stress_up"],
      }));
    }
  }

  return events;
}

function memoryUpdate(world, events) {
  for (const event of events) {
    for (const participantId of event.participants) {
      const agent = world.agents[participantId];
      if (!agent) {
        continue;
      }
      agent.memory.episodic.push({
        tick: event.tick,
        description: event.description,
      });
      if (event.importance >= 0.7) {
        agent.memory.strategic.push({
          tick: event.tick,
          implication: `应对${event.type}类事件`,
        });
      }
    }
  }
}

function createEvent(world, action, details) {
  return {
    id: `event-${world.time.tick}-${action.actorId}-${action.type}`,
    tick: world.time.tick,
    day: world.time.day,
    phase: world.time.phase,
    location: world.agents[action.actorId].identity.location,
    actor: world.agents[action.actorId].name,
    target: world.agents[action.targetId].name,
    subject: action.subject ?? null,
    type: action.type,
    utterance: action.utterance ?? "",
    participants: details.participants,
    description: details.description,
    consequences: details.consequences,
    visibility: details.visibility,
    importance: details.importance,
  };
}

function appendDebugRecords(world, records) {
  if (!world.metadata.debug) {
    world.metadata.debug = { decisions: [] };
  }
  world.metadata.debug.decisions.push(...records);
}

function buildDebugRecord(world, agentId, debug) {
  return {
    tick: world.time.tick,
    day: world.time.day,
    phase: world.time.phase,
    agentId,
    agent: world.agents[agentId].name,
    mode: debug.mode,
    advisorSource: debug.advisorSource,
    rationale: debug.rationale,
    topDrivers: debug.topDrivers,
    blendedScores: debug.blendedScores,
    utterance: debug.utterance,
  };
}

function advanceTime(world) {
  world.time.tick += 1;
  const currentIndex = PHASE_SEQUENCE.indexOf(world.time.phase);
  const nextIndex = (currentIndex + 1) % PHASE_SEQUENCE.length;
  world.time.phase = PHASE_SEQUENCE[nextIndex];
  if (nextIndex === 0) {
    world.time.day += 1;
  }

  for (const agent of Object.values(world.agents)) {
    agent.resources.time = 1;
    agent.internalState.fatigue = clamp(agent.internalState.fatigue + 0.08, 0, 1);
  }
}

function shiftRelation(world, sourceId, targetId, key, delta) {
  const source = world.agents[sourceId];
  if (!source.relations[targetId]) {
    return;
  }
  source.relations[targetId][key] = clamp(source.relations[targetId][key] + delta);
}
