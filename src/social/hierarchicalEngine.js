import { cloneWorldState, validateWorldState } from "../model.js";
import { advanceSocialTimeByBlock, applyPlannedAction } from "./stateUpdater.js";
import { planActionWithLLM } from "./actionPlanner.js";
import { planMainEvents, summarizeSubEvent } from "./eventPlanner.js";
import { writePlannerTrace } from "./llmTrace.js";
import { timelineLabel } from "./timeLabel.js";
import { parseJsonLenient } from "./jsonUtil.js";
import { printEventBlockTrace } from "./reporter.js";
import {
  createRun,
  createSimulationDatabase,
  writeEventRecord,
  writeMainEventChat,
  writeSnapshot,
  writeSubEventChat,
} from "./database.js";

function buildPlanningContext(world, randomFn) {
  const locationIndex = {};
  const factionLeaders = {};

  for (const agent of Object.values(world.agents)) {
    const location = agent.identity.location || "unknown";
    if (!locationIndex[location]) {
      locationIndex[location] = [];
    }
    locationIndex[location].push(agent.id);

    const faction = agent.identity.faction;
    if (!factionLeaders[faction] && /(君主|吴主|丞相|将军)/.test(agent.identity.role)) {
      factionLeaders[faction] = agent.id;
    }
  }

  return { locationIndex, factionLeaders, recentActorIds: [], randomFn };
}

function compactMainPlan(plan) {
  const block = plan?.timeBlock ?? {};
  const events = Array.isArray(plan?.events) ? plan.events : [];
  return {
    time_block: {
      amount: block.amount,
      unit: block.unit,
      days: block.days,
      start_phase: block.startPhase,
      end_phase: block.endPhase,
    },
    events: events.map((event) => ({
      id: event.eventId,
      title: event.title,
      participants: event.participantIds,
      schedule: event.schedule,
    })),
  };
}

function buildStepFeedback(world, day, phase, fromEventIndex) {
  const events = world.eventLog.slice(fromEventIndex);
  return {
    timeline_label: timelineLabel(world, day, phase),
    day,
    phase,
    generated_events: events.map((event) => ({
      actor: event.actor,
      summary: event.description,
      importance: event.importance,
      visibility: event.visibility,
    })),
    public_opinion: world.publicOpinion,
  };
}

function parsePayloadAfterPrefix(content, prefix) {
  if (typeof content !== "string" || !content.startsWith(prefix)) {
    return null;
  }
  return parseJsonLenient(content.slice(prefix.length).trim());
}

function buildCompactedHistorySummary(compactedMessages) {
  const planPrefix = "主事件计划:";
  const feedbackPrefix = "执行结果反馈:";
  let compactedRounds = 0;
  let totalEvents = 0;
  let totalBlockDays = 0;
  const actorCounts = new Map();
  const opinionSnapshots = [];

  for (const message of compactedMessages) {
    if (message.role === "assistant") {
      const markerIndex = String(message.content).indexOf(planPrefix);
      if (markerIndex >= 0) {
        const parsed = parseJsonLenient(String(message.content).slice(markerIndex + planPrefix.length).trim());
        const events = Array.isArray(parsed?.events) ? parsed.events : [];
        const blockDays = Number(parsed?.time_block?.days ?? 1);
        totalEvents += events.length;
        totalBlockDays += Number.isFinite(blockDays) ? Math.max(1, blockDays) : 1;
        compactedRounds += 1;
      }
    } else if (message.role === "user") {
      const parsed = parsePayloadAfterPrefix(message.content, feedbackPrefix);
      const generated = Array.isArray(parsed?.generated_events) ? parsed.generated_events : [];
      for (const event of generated) {
        const actor = String(event?.actor ?? "");
        if (!actor) {
          continue;
        }
        actorCounts.set(actor, (actorCounts.get(actor) ?? 0) + 1);
      }
      if (parsed?.public_opinion) {
        opinionSnapshots.push(parsed.public_opinion);
      }
    }
  }

  const topActors = [...actorCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([actor, count]) => ({ actor, count }));
  const lastOpinion = opinionSnapshots[opinionSnapshots.length - 1] ?? null;

  return {
    compacted_rounds: compactedRounds,
    approx_time_span_days: totalBlockDays,
    total_generated_events: totalEvents,
    top_active_actors: topActors,
    latest_public_opinion: lastOpinion,
  };
}

function buildMainChatHistoryMessages(mainChatHistory) {
  const RECENT_ROUNDS = 3;
  const recentMessageCount = RECENT_ROUNDS * 2;
  if (mainChatHistory.length <= recentMessageCount) {
    return mainChatHistory;
  }

  const compacted = mainChatHistory.slice(0, -recentMessageCount);
  const recent = mainChatHistory.slice(-recentMessageCount);
  const summary = buildCompactedHistorySummary(compacted);
  return [
    {
      role: "user",
      content: `历史摘要（压缩记忆）: ${JSON.stringify(summary)}`,
    },
    ...recent,
  ];
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

function buildIndependentEventBatches(events) {
  const batches = [];
  for (const event of events) {
    const participantSet = new Set(event.participantIds ?? []);
    const scheduleKey = `${event?.schedule?.offsetDays ?? 0}-${event?.schedule?.phase ?? "day"}`;
    let placed = false;
    for (const batch of batches) {
      if (batch.scheduleKey !== scheduleKey) {
        continue;
      }
      const overlaps = [...participantSet].some((id) => batch.participantSet.has(id));
      if (!overlaps) {
        batch.events.push(event);
        for (const id of participantSet) {
          batch.participantSet.add(id);
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push({ events: [event], participantSet, scheduleKey });
    }
  }
  return batches.map((batch) => batch.events);
}

function scheduleToSortKey(event) {
  const phaseOrder = { morning: 0, day: 1, night: 2 };
  const offset = Number(event?.schedule?.offsetDays ?? 0);
  const phase = phaseOrder[event?.schedule?.phase] ?? 1;
  return offset * 10 + phase;
}

export async function runHierarchicalSimulation(initialWorld, config) {
  const world = cloneWorldState(initialWorld);
  validateWorldState(world);

  const db = createSimulationDatabase(config.dbPath);
  const runId = createRun(db, world.title, {
    steps: config.steps,
    model: config.llm.model,
    orchestrationMode: "hierarchical",
  });
  const mainChatHistory = [];

  for (let step = 0; step < config.steps; step += 1) {
    if (config.debug) {
      console.log(`[orchestrator] step ${step + 1}/${config.steps} planning main events`);
    }

    const historyMessages = buildMainChatHistoryMessages(mainChatHistory);
    const main = await planMainEvents(world, config.llm, historyMessages);
    writeMainEventChat(db, runId, step, main.messages, main.raw, main.plan);
    if (config.llm.traceEnabled) {
      await writePlannerTrace({
        traceDir: config.llm.traceRunDir,
        kind: "main_event_chat",
        step,
        day: world.time.day,
        phase: world.time.phase,
        status: "ok",
        messages: main.messages,
        rawOutput: main.raw,
      });
    }
    mainChatHistory.push({
      role: "assistant",
      content: `${timelineLabel(world, world.time.day, world.time.phase)}主事件计划: ${JSON.stringify(compactMainPlan(main.plan))}`,
    });

    const timeBlock = main.plan.timeBlock ?? {
      amount: 3,
      unit: "day",
      days: 3,
      startPhase: world.time.phase,
      endPhase: "morning",
      reason: "",
    };
    const blockStartDay = world.time.day;
    const blockStartPhase = timeBlock.startPhase || world.time.phase;
    world.time.phase = blockStartPhase;
    const blockStartLabel = timelineLabel(world, blockStartDay, blockStartPhase);

    const events = [...main.plan.events].sort((left, right) => scheduleToSortKey(left) - scheduleToSortKey(right));

    const startEventIndex = world.eventLog.length;
    const batches = buildIndependentEventBatches(events);
    for (const batchEvents of batches) {
      if (batchEvents.length > 0) {
        const base = batchEvents[0].schedule ?? { offsetDays: 0, phase: blockStartPhase };
        world.time.day = blockStartDay + (base.offsetDays ?? 0);
        world.time.phase = base.phase ?? blockStartPhase;
      }
      const preparedBatch = await mapWithConcurrency(
        batchEvents,
        config.llmConcurrency,
        async (event) => {
          const sub = await summarizeSubEvent(world, event, config.llm);
          const planningContext = {
            ...buildPlanningContext(world, config.randomFn),
            currentEvent: {
              eventId: event.eventId,
              title: event.title,
              summary: sub.summary.eventSummary || event.summary,
              keyTensions: sub.summary.keyTensions,
              visibility: sub.summary.visibility,
              participantIds: event.participantIds,
            },
          };
          const actionPlans = await mapWithConcurrency(
            event.participantIds,
            config.llmConcurrency,
            async (agentId) => {
              if (!world.agents[agentId] || world.agents[agentId].resources.time <= 0) {
                return null;
              }
              const action = await planActionWithLLM(world, agentId, config.llm, planningContext);
              return { agentId, action };
            },
          );
          return { event, sub, actionPlans: actionPlans.filter(Boolean) };
        },
      );

      for (const prepared of preparedBatch) {
        const { event, sub, actionPlans } = prepared;
        writeSubEventChat(db, runId, step, event.eventId, sub.messages, sub.raw, sub.summary);
        if (config.llm.traceEnabled) {
          await writePlannerTrace({
            traceDir: config.llm.traceRunDir,
            kind: "sub_event_chat",
            step,
            day: world.time.day,
            phase: world.time.phase,
            eventId: event.eventId,
            status: "ok",
            messages: sub.messages,
            rawOutput: sub.raw,
          });
        }

        writeEventRecord(db, runId, step, {
          eventId: event.eventId,
          parentEventId: null,
          eventType: "sub_event_summary",
          title: event.title,
          summary: sub.summary.eventSummary || event.summary,
          participants: event.participantIds,
          payload: sub.summary,
        });

        for (const { agentId, action } of actionPlans) {
          applyPlannedAction(world, agentId, action, {
            debug: config.debug,
            randomness: config.randomness,
            randomFn: config.randomFn,
          });
          world.agents[agentId].resources.time = 0;
        }
      }
    }

    const endTime = advanceSocialTimeByBlock(world, timeBlock, {
      startDay: blockStartDay,
    });
    const blockEndLabel = timelineLabel(world, endTime.day, endTime.phase);
    printEventBlockTrace(world, {
      step,
      timeBlock,
      startLabel: blockStartLabel,
      endLabel: blockEndLabel,
      startEventIndex,
    });

    mainChatHistory.push({
      role: "user",
      content: `执行结果反馈: ${JSON.stringify({
        ...buildStepFeedback(world, endTime.day, endTime.phase, startEventIndex),
        time_block: timeBlock,
      })}`,
    });

    writeSnapshot(db, runId, step, world);
    validateWorldState(world);
  }

  world.metadata = world.metadata ?? {};
  world.metadata.runId = runId;
  world.metadata.dbPath = config.dbPath;
  return world;
}
