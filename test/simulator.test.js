import test from "node:test";
import assert from "node:assert/strict";

import { createChaisangScenario } from "../src/scenarios/chaisang.js";
import { runSimulation, runSimulationAsync, runSimulationTimeline, simulateTick } from "../src/simulator.js";

test("scenario boots with expected agents", () => {
  const world = createChaisangScenario();
  assert.equal(Object.keys(world.agents).length, 5);
  assert.equal(world.agents["sun-quan"].name, "孙权");
  assert.equal(world.time.tick, 0);
});

test("simulation advances time and logs events", () => {
  const world = createChaisangScenario();
  const next = simulateTick(world);

  assert.equal(next.time.tick, 1);
  assert.ok(next.eventLog.length >= 1);
  assert.ok(next.sceneLog.length >= 1);
});

test("multi-step run changes relations around the player", () => {
  const world = createChaisangScenario();
  const result = runSimulation(world, 3);

  const sunQuan = result.agents["sun-quan"];
  assert.ok(result.eventLog.some((event) => event.type === "rumor"));
  assert.ok(sunQuan.relations.player.trust < 0.1);
});

test("timeline includes initial snapshot plus each simulated tick", () => {
  const world = createChaisangScenario();
  const snapshots = runSimulationTimeline(world, 3);

  assert.equal(snapshots.length, 4);
  assert.equal(snapshots[0].time.tick, 0);
  assert.equal(snapshots[3].time.tick, 3);
});

test("async simulation falls back safely when llm key is missing", async () => {
  const world = createChaisangScenario();
  const result = await runSimulationAsync(world, 1, { enableLLM: true, llm: { apiKey: "" } });

  assert.equal(result.time.tick, 1);
  assert.ok(result.eventLog.length >= 1);
});
