function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function randomBetween(randomFn, min, max) {
  return min + (max - min) * randomFn();
}

function getPublicAxis(world, candidates, fallback = 0.5) {
  const opinion = world.publicOpinion && typeof world.publicOpinion === "object" ? world.publicOpinion : {};
  for (const key of candidates) {
    const value = Number(opinion[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return fallback;
}

function isPersuasionAction(label) {
  return /consult|discuss|negot|convince|alliance|说服|劝|议|盟|会谈|协商/i.test(String(label ?? ""));
}

function isBattleAction(label) {
  return /battle|attack|raid|strike|assault|engage|交战|进攻|突袭|火攻|攻/i.test(String(label ?? ""));
}

function resolveAgreementRoll(world, actorId, targetId, action, options) {
  const target = world.agents[targetId];
  const actor = world.agents[actorId];
  if (!target || !actor) {
    return null;
  }
  const randomFn = options.randomFn ?? Math.random;
  const decisionNoise = Number(options.randomness?.decisionNoise ?? 0);
  const relation = target.relations[actorId] ?? {
    trust: 0, respect: 0, resentment: 0, fear: 0,
  };

  const deterministic = clamp(
    0.48
      + 0.24 * relation.trust
      + 0.12 * relation.respect
      - 0.16 * relation.resentment
      + 0.08 * (actor.resources.influence - target.resources.influence)
      + 0.08 * (action.subjectiveSituation?.certainty ?? 0.5)
      - 0.06 * Math.max(0, target.internalState.stress),
    0.05,
    0.95,
  );
  const stochastic = randomBetween(randomFn, -decisionNoise, decisionNoise);
  const probability = clamp(deterministic + stochastic, 0.01, 0.99);
  const roll = randomFn();
  const accepted = roll < probability;

  if (accepted) {
    ensureRelation(target, actorId);
    target.relations[actorId].trust = round2(clamp(target.relations[actorId].trust + 0.03, -1, 1));
    target.relations[actorId].respect = round2(clamp(target.relations[actorId].respect + 0.02, -1, 1));
  } else {
    ensureRelation(target, actorId);
    target.relations[actorId].resentment = round2(clamp(target.relations[actorId].resentment + 0.03, -1, 1));
  }

  return {
    targetId,
    target: target.name,
    accepted,
    deterministic: round2(deterministic),
    stochastic: round2(stochastic),
    probability: round2(probability),
    roll: round2(roll),
  };
}

function resolveBattleRoll(world, actorId, action, options) {
  const actor = world.agents[actorId];
  const defenderId = action.targetIds?.[0];
  const defender = world.agents[defenderId];
  if (!actor || !defender) {
    return null;
  }
  const randomFn = options.randomFn ?? Math.random;
  const battleNoise = Number(options.randomness?.battleNoise ?? 0.2);

  const momentum = getPublicAxis(world, ["morale", "combat_morale", "stability", "order", "confidence"], 0.5);

  const atkStrength = Math.log1p(actor.resources.troops) * (1 + actor.internalState.confidence * 0.25) * (0.7 + momentum * 0.3);
  const defStrength = Math.log1p(defender.resources.troops) * (1 + defender.internalState.confidence * 0.22) * (0.7 + momentum * 0.3);
  const strengthGap = atkStrength - defStrength;
  const deterministic = sigmoid(strengthGap * 0.6);
  const stochastic = randomBetween(randomFn, -battleNoise, battleNoise);
  const probability = clamp(deterministic + stochastic, 0.01, 0.99);
  const roll = randomFn();
  const attackerWin = roll < probability;

  const baseLossRate = attackerWin ? 0.03 : 0.08;
  const defenderLossRate = attackerWin ? 0.1 : 0.04;
  const jitterA = randomBetween(randomFn, -0.01, 0.02);
  const jitterD = randomBetween(randomFn, -0.01, 0.02);
  const attackerLoss = Math.round(actor.resources.troops * Math.max(0.01, baseLossRate + jitterA));
  const defenderLoss = Math.round(defender.resources.troops * Math.max(0.01, defenderLossRate + jitterD));

  actor.resources.troops = Math.max(0, actor.resources.troops - attackerLoss);
  defender.resources.troops = Math.max(0, defender.resources.troops - defenderLoss);
  actor.internalState.confidence = round2(clamp(actor.internalState.confidence + (attackerWin ? 0.06 : -0.08), -1, 1));
  defender.internalState.confidence = round2(clamp(defender.internalState.confidence + (attackerWin ? -0.08 : 0.05), -1, 1));

  return {
    type: "battle_roll",
    targetId: defenderId,
    target: defender.name,
    attackerWin,
    deterministic: round2(deterministic),
    stochastic: round2(stochastic),
    probability: round2(probability),
    roll: round2(roll),
    attackerLoss,
    defenderLoss,
  };
}

function ensureRelation(agent, targetId) {
  if (!agent.relations[targetId]) {
    agent.relations[targetId] = {
      trust: 0,
      respect: 0,
      fear: 0,
      resentment: 0,
      obligation: 0,
      attraction: 0,
    };
  }
}

function applyRelationDelta(agent, targetId, relationUpdate) {
  ensureRelation(agent, targetId);
  agent.relations[targetId].trust = round2(clamp(agent.relations[targetId].trust + relationUpdate.trust_delta, -1, 1));
  agent.relations[targetId].respect = round2(clamp(agent.relations[targetId].respect + relationUpdate.respect_delta, -1, 1));
  agent.relations[targetId].fear = round2(clamp(agent.relations[targetId].fear + relationUpdate.fear_delta, -1, 1));
  agent.relations[targetId].resentment = round2(clamp(agent.relations[targetId].resentment + relationUpdate.resentment_delta, -1, 1));
  agent.relations[targetId].obligation = round2(clamp(agent.relations[targetId].obligation + relationUpdate.obligation_delta, -1, 1));
  agent.relations[targetId].attraction = round2(clamp(agent.relations[targetId].attraction + relationUpdate.attraction_delta, -1, 1));
}

function normalizeOpinionKey(key) {
  return String(key ?? "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function toCamelKey(snake) {
  return String(snake).replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
}

function snapshotOpinion(opinion) {
  const source = opinion && typeof opinion === "object" ? opinion : {};
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      continue;
    }
    out[normalizeOpinionKey(key)] = round2(num);
  }
  return out;
}

function applyPublicOpinionDelta(world, updates) {
  const source = updates && typeof updates === "object" ? updates : {};
  world.publicOpinion = world.publicOpinion && typeof world.publicOpinion === "object" ? world.publicOpinion : {};
  for (const [rawKey, rawDelta] of Object.entries(source)) {
    const deltaNum = Number(rawDelta);
    if (!Number.isFinite(deltaNum) || deltaNum === 0) {
      continue;
    }
    const normalized = normalizeOpinionKey(rawKey).replace(/_delta$/, "");
    const camel = toCamelKey(normalized);
    const preferredKey = Object.prototype.hasOwnProperty.call(world.publicOpinion, normalized)
      ? normalized
      : Object.prototype.hasOwnProperty.call(world.publicOpinion, camel)
        ? camel
        : normalized;
    const current = Number(world.publicOpinion[preferredKey] ?? 0.5);
    world.publicOpinion[preferredKey] = round2(clamp((Number.isFinite(current) ? current : 0.5) + deltaNum, 0, 1));
  }
}

function getPathContainer(root, pathParts) {
  let ref = root;
  for (const key of pathParts.slice(0, -1)) {
    if (!ref[key] || typeof ref[key] !== "object" || Array.isArray(ref[key])) {
      ref[key] = {};
    }
    ref = ref[key];
  }
  return ref;
}

function applyDomainUpdates(world, updates) {
  const list = Array.isArray(updates) ? updates : [];
  for (const item of list) {
    const target = world.agents[item?.id];
    if (!target) {
      continue;
    }
    target.domain = target.domain && typeof target.domain === "object" ? target.domain : {};
    const containerName = String(item?.container ?? "extra").trim() || "extra";
    if (!target.domain[containerName] || typeof target.domain[containerName] !== "object" || Array.isArray(target.domain[containerName])) {
      target.domain[containerName] = {};
    }
    const key = String(item?.key ?? "").trim();
    if (!key) {
      continue;
    }
    const mode = String(item?.mode ?? (item?.value !== undefined ? "set" : "delta")).toLowerCase();
    const parts = key.split(".").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const holder = getPathContainer(target.domain[containerName], parts);
    const leaf = parts[parts.length - 1];

    if (mode === "remove" || mode === "delete") {
      delete holder[leaf];
      continue;
    }

    if (mode === "set" || !Number.isFinite(Number(item?.delta))) {
      const value = item?.value;
      holder[leaf] = typeof value === "number" ? round2(value) : value;
      continue;
    }

    const current = Number(holder[leaf] ?? 0);
    const delta = Number(item?.delta ?? 0);
    holder[leaf] = round2((Number.isFinite(current) ? current : 0) + delta);
  }
}

export function applyPlannedAction(world, actorId, action, options = {}) {
  const actor = world.agents[actorId];
  const stochasticDetails = [];
  const opinionBefore = snapshotOpinion(world.publicOpinion);

  for (const relation of action.stateUpdates.relationUpdates) {
    const source = world.agents[relation.from];
    if (!source) {
      continue;
    }
    applyRelationDelta(source, relation.to, relation);
  }

  for (const update of action.stateUpdates.internalUpdates) {
    const target = world.agents[update.id];
    if (!target) {
      continue;
    }
    target.internalState.mood = round2(clamp(target.internalState.mood + update.mood_delta, -1, 1));
    target.internalState.stress = round2(clamp(target.internalState.stress + update.stress_delta, -1, 1));
    target.internalState.fatigue = round2(clamp(target.internalState.fatigue + update.fatigue_delta, 0, 1));
    target.internalState.confidence = round2(clamp(target.internalState.confidence + update.confidence_delta, -1, 1));
  }

  for (const update of action.stateUpdates.resourceUpdates) {
    const target = world.agents[update.id];
    if (!target) {
      continue;
    }
    target.resources.money = round2(Math.max(0, target.resources.money + update.money_delta));
    target.resources.troops = Math.max(0, Math.round(target.resources.troops + update.troops_delta));
    target.resources.influence = round2(clamp(target.resources.influence + update.influence_delta, 0, 1));
    target.resources.informationAccess = round2(clamp(target.resources.informationAccess + update.information_access_delta, 0, 1));
    target.resources.time = round2(Math.max(0, target.resources.time + update.time_delta));
  }

  for (const update of action.stateUpdates.beliefUpdates) {
    const target = world.agents[update.id];
    if (!target) {
      continue;
    }
    target.beliefs.push({
      topic: update.topic,
      stance: update.stance,
      confidence: round2(clamp(update.confidence, 0, 1)),
      source: actor.name,
      tick: world.time.tick,
    });
  }

  applyPublicOpinionDelta(world, action.stateUpdates.publicOpinionUpdates);
  applyDomainUpdates(world, action.stateUpdates.domainUpdates);
  const opinionAfter = snapshotOpinion(world.publicOpinion);

  if (isPersuasionAction(action.actionLabel) && Array.isArray(action.targetIds) && action.targetIds.length > 0) {
    for (const targetId of action.targetIds) {
      const detail = resolveAgreementRoll(world, actorId, targetId, action, options);
      if (detail) {
        stochasticDetails.push({ type: "agreement_roll", ...detail });
      }
    }
  }

  if (isBattleAction(action.actionLabel) && Array.isArray(action.targetIds) && action.targetIds.length > 0) {
    const battleDetail = resolveBattleRoll(world, actorId, action, options);
    if (battleDetail) {
      stochasticDetails.push(battleDetail);
    }
  }

  const participants = Array.from(new Set([
    actorId,
    ...(action.targetIds ?? []),
    ...(action.participantIds ?? []),
    ...((action.actions ?? []).flatMap((item) => item.targetIds ?? [])),
    ...((action.dialogue ?? []).flatMap((turn) => [turn.speakerId, ...(turn.targetIds ?? [])])),
  ]));
  const dialogueText = Array.isArray(action.dialogue)
    ? action.dialogue
      .slice(0, 6)
      .map((turn) => `${world.agents[turn.speakerId]?.name ?? turn.speakerId}：${turn.text}`)
      .join(" / ")
    : "";
  const event = {
    id: `event-${world.time.tick}-${actorId}-${world.eventLog.length}`,
    tick: world.time.tick,
    day: world.time.day,
    phase: world.time.phase,
    location: actor.identity.location,
    actor: actor.name,
    target: action.targetIds.map((id) => world.agents[id]?.name ?? id).join("、"),
    subject: action.actionLabel,
    type: "llm-action",
    participants,
    description: action.summary || `${actor.name}执行了${action.actionLabel}`,
    utterance: action.speech || dialogueText,
    actions: action.actions ?? [],
    dialogue: action.dialogue ?? [],
    consequences: [],
    visibility: round2(clamp(action.visibility ?? 0.6, 0, 1)),
    importance: clamp(
      0.4
        + Object.values(action.stateUpdates.publicOpinionUpdates ?? {}).reduce((sum, value) => sum + Math.abs(Number(value) || 0), 0)
        + action.drivers.length * 0.04,
      0,
      1,
    ),
    debug: {
      rationale: action.rationale,
      drivers: action.drivers,
      label: action.actionLabel,
      stochasticDetails,
      opinionBefore,
      opinionAfter,
    },
  };

  world.eventLog.push(event);
  actor.memory.semantic.push({
    tick: world.time.tick,
    day: world.time.day,
    phase: world.time.phase,
    topic: "subjective_situation",
    overall: action.subjectiveSituation?.overall ?? "",
    threat: action.subjectiveSituation?.threat ?? "",
    opportunity: action.subjectiveSituation?.opportunity ?? "",
      certainty: round2(action.subjectiveSituation?.certainty ?? 0.5),
    bias: action.subjectiveSituation?.bias ?? "",
  });

  for (const id of participants) {
    const participant = world.agents[id];
    if (!participant) {
      continue;
    }
    participant.memory.episodic.push({
      tick: world.time.tick,
      description: event.description,
    });
  }

  if (options.debug) {
    world.metadata.debug.decisions.push({
      tick: world.time.tick,
      day: world.time.day,
      phase: world.time.phase,
      agentId: actorId,
      agent: actor.name,
      actionLabel: action.actionLabel,
      rationale: action.rationale,
      drivers: action.drivers,
      speech: action.speech,
      summary: action.summary,
      subjectiveSituation: action.subjectiveSituation,
      stochasticDetails,
      actions: action.actions ?? [],
      dialogue: action.dialogue ?? [],
    });
  }
}

const PHASE_SEQUENCE = ["morning", "day", "night"];

export function advanceSocialTime(world) {
  world.time.tick += 1;
  const current = PHASE_SEQUENCE.indexOf(world.time.phase);
  const next = (current + 1) % PHASE_SEQUENCE.length;
  world.time.phase = PHASE_SEQUENCE[next];
  if (next === 0) {
    world.time.day += 1;
  }
  for (const agent of Object.values(world.agents)) {
    agent.resources.time = 1;
    agent.internalState.fatigue = round2(clamp(agent.internalState.fatigue + 0.06, 0, 1));
  }
}

function blockToDays(block) {
  const amount = Math.max(1, Math.trunc(Number(block?.amount ?? 1)));
  const unit = String(block?.unit ?? "day").toLowerCase();
  if (unit === "week") {
    return amount * 7;
  }
  if (unit === "month") {
    return amount * 30;
  }
  return amount;
}

export function advanceSocialTimeByBlock(world, block, options = {}) {
  const startDay = Number(options.startDay ?? world.time.day ?? 1);
  const days = Math.max(1, blockToDays(block));
  const requestedEndPhase = String(block?.endPhase ?? "morning");
  const endPhase = PHASE_SEQUENCE.includes(requestedEndPhase) ? requestedEndPhase : "morning";
  world.time.tick += 1;
  world.time.day = startDay + days;
  world.time.phase = endPhase;

  const restFactor = Math.min(0.55, 0.12 + days * 0.02);
  const stressRelief = Math.min(0.3, 0.04 + days * 0.01);
  for (const agent of Object.values(world.agents)) {
    agent.resources.time = 1;
    agent.internalState.fatigue = round2(clamp(agent.internalState.fatigue * (1 - restFactor), 0, 1));
    agent.internalState.stress = round2(clamp(agent.internalState.stress - stressRelief, -1, 1));
  }
  return { day: world.time.day, phase: world.time.phase, tick: world.time.tick };
}
