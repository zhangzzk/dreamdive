const RELATION_KEYS = ["trust", "respect", "fear", "resentment", "obligation", "attraction"];
const MEMORY_KEYS = ["episodic", "semantic", "strategic"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function completeRelation(partial = {}) {
  return Object.fromEntries(
    RELATION_KEYS.map((key) => [key, clamp(partial[key] ?? 0)]),
  );
}

function completeMemory(partial = {}) {
  return Object.fromEntries(MEMORY_KEYS.map((key) => [key, [...(partial[key] ?? [])]]));
}


function clonePlainObject(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(Object.entries(input));
}

export function createAgentState(agent) {
  assert(agent?.id, "Agent requires an id.");
  assert(agent?.name, `Agent ${agent.id} requires a name.`);

  return {
    id: agent.id,
    name: agent.name,
    identity: {
      origin: agent.identity?.origin ?? "unknown",
      faction: agent.identity?.faction ?? "independent",
      socialClass: agent.identity?.socialClass ?? "common",
      role: agent.identity?.role ?? "unknown",
      location: agent.identity?.location ?? "unknown",
    },
    traits: {
      ambition: clamp(agent.traits?.ambition ?? 0),
      prudence: clamp(agent.traits?.prudence ?? 0),
      impulsiveness: clamp(agent.traits?.impulsiveness ?? 0),
      empathy: clamp(agent.traits?.empathy ?? 0),
      pride: clamp(agent.traits?.pride ?? 0),
      loyalty: clamp(agent.traits?.loyalty ?? 0),
      ruthlessness: clamp(agent.traits?.ruthlessness ?? 0),
    },
    drives: {
      survival: clamp(agent.drives?.survival ?? 0),
      power: clamp(agent.drives?.power ?? 0),
      status: clamp(agent.drives?.status ?? 0),
      wealth: clamp(agent.drives?.wealth ?? 0),
      belonging: clamp(agent.drives?.belonging ?? 0),
      morality: clamp(agent.drives?.morality ?? 0),
      desire: clamp(agent.drives?.desire ?? 0),
      revenge: clamp(agent.drives?.revenge ?? 0),
    },
    internalState: {
      mood: clamp(agent.internalState?.mood ?? 0),
      stress: clamp(agent.internalState?.stress ?? 0),
      fatigue: clamp(agent.internalState?.fatigue ?? 0, 0, 1),
      confidence: clamp(agent.internalState?.confidence ?? 0),
    },
    beliefs: [...(agent.beliefs ?? [])],
    relations: Object.fromEntries(
      Object.entries(agent.relations ?? {}).map(([otherId, relation]) => [otherId, completeRelation(relation)]),
    ),
    resources: {
      money: Math.max(0, agent.resources?.money ?? 0),
      troops: Math.max(0, agent.resources?.troops ?? 0),
      influence: Math.max(0, agent.resources?.influence ?? 0),
      informationAccess: clamp(agent.resources?.informationAccess ?? 0, 0, 1),
      time: Math.max(0, agent.resources?.time ?? 1),
    },
    profile: {
      hobbies: [...(agent.profile?.hobbies ?? [])],
      dislikes: [...(agent.profile?.dislikes ?? [])],
      family: String(agent.profile?.family ?? ""),
      hiddenWorry: String(agent.profile?.hiddenWorry ?? ""),
      habit: String(agent.profile?.habit ?? ""),
      privateGoal: String(agent.profile?.privateGoal ?? ""),
    },
    domain: {
      traits: clonePlainObject(agent.domain?.traits),
      states: clonePlainObject(agent.domain?.states),
      resources: clonePlainObject(agent.domain?.resources),
      capabilities: clonePlainObject(agent.domain?.capabilities),
      relations: clonePlainObject(agent.domain?.relations),
      publicAxes: clonePlainObject(agent.domain?.publicAxes),
      extra: clonePlainObject(agent.domain?.extra),
    },
    memory: completeMemory(agent.memory),
    currentGoal: agent.currentGoal ?? null,
    tags: [...(agent.tags ?? [])],
  };
}

export function createWorldState(world) {
  assert(world?.id, "World requires an id.");
  const agents = Object.fromEntries(
    (world.agents ?? []).map((agent) => [agent.id, createAgentState(agent)]),
  );

  return {
    id: world.id,
    title: world.title ?? world.id,
    time: {
      day: world.time?.day ?? 1,
      phase: world.time?.phase ?? "morning",
      tick: world.time?.tick ?? 0,
    },
    space: {
      nodes: [...(world.space?.nodes ?? [])],
      edges: [...(world.space?.edges ?? [])],
    },
    norms: {
      honorCulture: clamp(world.norms?.honorCulture ?? 0, 0, 1),
      hierarchyRigidity: clamp(world.norms?.hierarchyRigidity ?? 0, 0, 1),
      punishmentForBetrayal: clamp(world.norms?.punishmentForBetrayal ?? 0, 0, 1),
      genderRestrictions: clamp(world.norms?.genderRestrictions ?? 0, 0, 1),
    },
    publicOpinion: { ...(world.publicOpinion ?? {}) },
    agents,
    eventLog: [...(world.eventLog ?? [])],
    sceneLog: [...(world.sceneLog ?? [])],
    metadata: { ...(world.metadata ?? {}) },
  };
}

export function validateWorldState(world) {
  assert(world?.agents && typeof world.agents === "object", "World agents must be an object.");

  for (const [agentId, agent] of Object.entries(world.agents)) {
    assert(agent.id === agentId, `Agent key mismatch for ${agentId}.`);
    for (const relationId of Object.keys(agent.relations)) {
      assert(world.agents[relationId], `Unknown relation target ${relationId} for ${agentId}.`);
    }
  }

  return true;
}

export function cloneWorldState(world) {
  return structuredClone(world);
}
