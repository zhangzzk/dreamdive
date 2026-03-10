import { cloneWorldState, validateWorldState } from "../model.js";
import { planActionWithLLM } from "./actionPlanner.js";
import { advanceSocialTime, applyPlannedAction } from "./stateUpdater.js";
import { rolePriorityByKeywords } from "./framework.js";

function shuffle(input, randomFn = Math.random) {
  const array = [...input];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const next = Math.floor(randomFn() * (index + 1));
    [array[index], array[next]] = [array[next], array[index]];
  }
  return array;
}

function rolePriority(agent, framework) {
  return rolePriorityByKeywords(agent.identity?.role, framework);
}

function shouldAgentAct(agent, baseRatio, framework, randomFn = Math.random) {
  const stressBoost = Math.max(0, agent.internalState.stress) * 0.15;
  const fatiguePenalty = agent.internalState.fatigue * 0.2;
  const confidenceBoost = Math.max(0, agent.internalState.confidence) * 0.06;
  const propensity = Math.max(
    0.08,
    Math.min(0.95, baseRatio + rolePriority(agent, framework) + stressBoost + confidenceBoost - fatiguePenalty),
  );
  return randomFn() < propensity;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const safeConcurrency = Math.max(1, concurrency);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function buildPlanningContext(world, framework) {
  const locationIndex = {};
  const factionLeaders = {};

  for (const agent of Object.values(world.agents)) {
    const location = agent.identity.location || "unknown";
    if (!locationIndex[location]) {
      locationIndex[location] = [];
    }
    locationIndex[location].push(agent.id);

    const faction = agent.identity.faction;
    if (!factionLeaders[faction] && rolePriorityByKeywords(agent.identity.role, framework) >= 0.16) {
      factionLeaders[faction] = agent.id;
    }
  }

  const recentActorIds = Array.from(
    new Set(
      world.eventLog
        .slice(-8)
        .flatMap((event) => [event.participants ?? [], event.actorId ? [event.actorId] : []])
        .flat()
        .filter(Boolean),
    ),
  );

  return { locationIndex, factionLeaders, recentActorIds };
}

export async function runSocialSimulation(initialWorld, config) {
  const world = cloneWorldState(initialWorld);
  validateWorldState(world);
  const randomFn = config.randomFn ?? Math.random;

  for (let step = 0; step < config.steps; step += 1) {
    const planningContext = buildPlanningContext(world, config.framework);
    planningContext.randomFn = randomFn;
    const shuffledIds = shuffle(
      Object.values(world.agents)
        .filter((agent) => agent.resources.time > 0 && agent.internalState.fatigue < 1)
        .map((agent) => agent.id),
      randomFn,
    );
    const sampledIds = shuffledIds.filter((id) => shouldAgentAct(world.agents[id], config.activeRatioPerTick, config.framework, randomFn));
    const activeAgentIdsRaw = sampledIds.length > 0 ? sampledIds : shuffledIds.slice(0, 1);
    const activeAgentIds =
      config.maxActorsPerTick > 0 ? activeAgentIdsRaw.slice(0, config.maxActorsPerTick) : activeAgentIdsRaw;

    if (config.debug) {
      console.log(
        `[progress] tick ${step + 1}/${config.steps}: active actors ${activeAgentIds.length}/${shuffledIds.length}`,
      );
    }

    if (config.planningMode === "parallel") {
      const plans = await mapWithConcurrency(
        activeAgentIds,
        config.llmConcurrency,
        async (agentId, index) => {
          if (config.debug) {
            console.log(
              `[progress] tick ${step + 1}/${config.steps} plan ${index + 1}/${activeAgentIds.length}: ${world.agents[agentId].name}`,
            );
          }
          const action = await planActionWithLLM(world, agentId, config.llm, planningContext);
          return { agentId, action };
        },
      );

      for (let index = 0; index < plans.length; index += 1) {
        const { agentId, action } = plans[index];
        if (config.debug) {
          console.log(
            `[progress] tick ${step + 1}/${config.steps} apply ${index + 1}/${plans.length}: ${world.agents[agentId].name}`,
          );
        }
        applyPlannedAction(world, agentId, action, { debug: config.debug, randomness: config.randomness, randomFn });
        world.agents[agentId].resources.time = 0;
      }
    } else {
      for (let index = 0; index < activeAgentIds.length; index += 1) {
        const agentId = activeAgentIds[index];
        if (config.debug) {
          console.log(
            `[progress] tick ${step + 1}/${config.steps} seq ${index + 1}/${activeAgentIds.length}: ${world.agents[agentId].name}`,
          );
        }
        const action = await planActionWithLLM(world, agentId, config.llm, planningContext);
        applyPlannedAction(world, agentId, action, { debug: config.debug, randomness: config.randomness, randomFn });
        world.agents[agentId].resources.time = 0;
      }
    }

    advanceSocialTime(world);
    validateWorldState(world);
  }

  return world;
}
