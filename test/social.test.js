import test from "node:test";
import assert from "node:assert/strict";

import { createRedCliffInitialState } from "../src/social/seedRedCliff.js";
import { applyPlannedAction } from "../src/social/stateUpdater.js";

test("red cliff seed has major cast and no player agent", () => {
  const world = createRedCliffInitialState();
  const names = Object.values(world.agents).map((agent) => agent.name);

  assert.ok(Object.keys(world.agents).length >= 12);
  assert.ok(names.includes("曹操"));
  assert.ok(names.includes("孙权"));
  assert.ok(names.includes("刘备"));
  assert.equal(names.includes("玩家使者"), false);
});

test("state updater applies llm action deltas and records event", () => {
  const world = createRedCliffInitialState();
  const action = {
    actionLabel: "试探结盟",
    targetIds: ["sun-quan"],
    speech: "曹操：若不早降，祸及江东。",
    summary: "曹操向孙权施压并试探和谈。",
    rationale: "以威逼利诱动摇吴方主战意志。",
    drivers: [{ factor: "权力动机", weight: 0.8, evidence: "兵力优势" }],
    stateUpdates: {
      relationUpdates: [
        {
          from: "sun-quan",
          to: "cao-cao",
          trust_delta: -0.12,
          respect_delta: 0.02,
          fear_delta: 0.1,
          resentment_delta: 0.08,
          obligation_delta: 0,
          attraction_delta: 0,
        },
      ],
      internalUpdates: [{ id: "sun-quan", mood_delta: -0.06, stress_delta: 0.1, fatigue_delta: 0, confidence_delta: -0.03 }],
      resourceUpdates: [],
      beliefUpdates: [{ id: "sun-quan", topic: "曹操施压", stance: "短期和谈风险高", confidence: 0.76 }],
      publicOpinionUpdates: {
        legitimacy_delta: 0,
        alliance_pressure_delta: 0.08,
        court_suspicion_delta: 0.05,
        morale_delta: -0.04,
      },
    },
  };

  applyPlannedAction(world, "cao-cao", action, { debug: true });

  assert.equal(world.eventLog.length, 1);
  assert.equal(world.eventLog[0].utterance, "曹操：若不早降，祸及江东。");
  assert.ok(world.agents["sun-quan"].relations["cao-cao"].trust < 0);
  assert.ok(world.publicOpinion.alliancePressure > 0.7);
  assert.equal(world.metadata.debug.decisions.length, 1);
});
