import { createChaisangScenario } from "../src/scenarios/chaisang.js";
import { simulateTick } from "../src/simulator.js";

let snapshots = [createChaisangScenario()];
let currentIndex = 0;
let selectedAgentId = snapshots[0].metadata.playerId;

const tickRange = document.querySelector("#tickRange");
const tickLabel = document.querySelector("#tickLabel");
const metricSelect = document.querySelector("#metricSelect");
const backButton = document.querySelector("#backButton");
const stepButton = document.querySelector("#stepButton");
const resetButton = document.querySelector("#resetButton");
const graph = document.querySelector("#graph");
const inspector = document.querySelector("#agentInspector");
const eventList = document.querySelector("#eventList");
const sceneList = document.querySelector("#sceneList");

const phaseLabel = {
  morning: "早晨",
  day: "白天",
  night: "夜晚",
};
const goalLabel = {
  observe: "观察局势",
  form_alliance: "推动结盟",
  spread_rumor: "散布流言",
  challenge_rival: "公开质疑",
};
const traitLabel = {
  ambition: "野心",
  prudence: "谨慎",
  impulsiveness: "冲动",
  empathy: "共情",
  pride: "自尊",
  loyalty: "忠诚",
  ruthlessness: "果决",
};

tickRange.addEventListener("input", () => {
  currentIndex = Number(tickRange.value);
  render();
});
metricSelect.addEventListener("change", render);
backButton.addEventListener("click", stepBack);
stepButton.addEventListener("click", stepForward);
resetButton.addEventListener("click", resetWorld);

syncTickControls();
render();

function stepForward() {
  if (currentIndex === snapshots.length - 1) {
    const next = simulateTick(snapshots[snapshots.length - 1]);
    snapshots.push(next);
  }
  currentIndex += 1;
  syncTickControls();
  render();
}

function stepBack() {
  if (currentIndex === 0) {
    return;
  }
  currentIndex -= 1;
  syncTickControls();
  render();
}

function resetWorld() {
  snapshots = [createChaisangScenario()];
  currentIndex = 0;
  selectedAgentId = snapshots[0].metadata.playerId;
  syncTickControls();
  render();
}

function syncTickControls() {
  tickRange.min = "0";
  tickRange.max = String(snapshots.length - 1);
  tickRange.value = String(currentIndex);
  backButton.disabled = currentIndex === 0;
}

function render() {
  const snapshot = snapshots[currentIndex];
  const metric = metricSelect.value;
  tickLabel.textContent = `时间步 ${snapshot.time.tick}  第 ${snapshot.time.day} 天  ${phaseLabel[snapshot.time.phase] ?? snapshot.time.phase}`;
  renderGraph(snapshot, metric);
  renderInspector(snapshot, selectedAgentId);
  renderTimelines(snapshot);
}

function renderGraph(snapshot, metric) {
  const agents = Object.values(snapshot.agents);
  const positions = circularLayout(agents.map((agent) => agent.id), 460, 300, 228);
  const fragments = [];

  for (const source of agents) {
    for (const [targetId, relation] of Object.entries(source.relations)) {
      const value = relation[metric] ?? 0;
      if (Math.abs(value) < 0.06 || !positions[targetId]) {
        continue;
      }
      const a = positions[source.id];
      const b = positions[targetId];
      const stroke = value >= 0 ? "#2d7f5e" : "#a1302d";
      const width = 0.7 + Math.abs(value) * 4.2;
      const alpha = 0.2 + Math.abs(value) * 0.7;
      fragments.push(
        `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${stroke}" stroke-width="${width}" opacity="${alpha.toFixed(2)}" />`,
      );
      fragments.push(
        `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" class="edge-label" fill="#5f5852" font-size="12">${value.toFixed(2)}</text>`,
      );
    }
  }

  for (const agent of agents) {
    const pos = positions[agent.id];
    const active = selectedAgentId === agent.id;
    const ring = active ? "#9e4128" : "#8d8375";
    const fill = agent.id === snapshot.metadata.playerId ? "#f5bb7a" : "#f8f4ee";
    fragments.push(
      `<g data-agent="${agent.id}" class="agent-node" style="cursor:pointer">
        <circle cx="${pos.x}" cy="${pos.y}" r="${active ? 38 : 34}" fill="${fill}" stroke="${ring}" stroke-width="${active ? 4 : 2}" />
        <text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" fill="#232120" font-size="13">${escapeText(shortName(agent.name))}</text>
      </g>`,
    );
  }

  graph.innerHTML = fragments.join("");
  for (const node of graph.querySelectorAll(".agent-node")) {
    node.addEventListener("click", () => {
      selectedAgentId = node.getAttribute("data-agent");
      render();
    });
  }
}

function renderInspector(snapshot, agentId) {
  const agent = snapshot.agents[agentId];
  if (!agent) {
    inspector.innerHTML = "<p>未选择角色。</p>";
    return;
  }

  inspector.innerHTML = `
    <div>
      <h3 class="agent-name">${escapeText(agent.name)}</h3>
      <p class="muted">${escapeText(agent.identity.role)} · ${escapeText(agent.identity.faction)} · ${escapeText(agent.identity.location)}</p>
      <div>${Object.entries(agent.traits).slice(0, 4).map(([key, value]) => `<span class="pill">${escapeText(traitLabel[key] ?? key)} ${formatSigned(value)}</span>`).join("")}</div>
    </div>
    <div>
      <strong>当前目标：</strong> ${escapeText(goalLabel[agent.currentGoal] ?? "暂无")}
    </div>
    <div>
      <strong>决策引擎</strong>
      <div class="muted">${escapeText(agent.lastDecision?.mode ?? "hybrid")} · tick ${agent.lastDecision?.tick ?? "-"}</div>
      <div class="muted">${escapeText(agent.lastDecision?.rationale ?? "暂无决策说明。")}</div>
    </div>
    <div>
      <strong>内部状态</strong>
      <div class="kv">
        <span>情绪</span><span class="${signedClass(agent.internalState.mood)}">${formatSigned(agent.internalState.mood)}</span>
        <span>压力</span><span>${agent.internalState.stress.toFixed(2)}</span>
        <span>疲劳</span><span>${agent.internalState.fatigue.toFixed(2)}</span>
        <span>信心</span><span>${agent.internalState.confidence.toFixed(2)}</span>
      </div>
    </div>
    <div>
      <strong>关键关系</strong>
      <div class="kv">
        ${Object.entries(agent.relations)
          .map(([otherId, relation]) => {
            const otherName = snapshot.agents[otherId]?.name ?? otherId;
            return `<span>${escapeText(otherName)} 的信任</span><span class="${signedClass(relation.trust)}">${formatSigned(relation.trust)}</span>`;
          })
          .join("")}
      </div>
    </div>
    <div>
      <strong>记忆</strong>
      <div class="muted">情景记忆 ${agent.memory.episodic.length} · 策略记忆 ${agent.memory.strategic.length}</div>
    </div>
  `;
}

function renderTimelines(snapshot) {
  const currentTick = snapshot.time.tick;
  const tickEvents = snapshot.eventLog.filter((event) => event.tick === currentTick - 1);
  const tickScenes = snapshot.sceneLog.filter((scene) => scene.tick === currentTick - 1);

  eventList.innerHTML = tickEvents
    .map(
      (event) => `
        <li>
          <div class="time">第 ${event.day} 天 · ${phaseLabel[event.phase] ?? event.phase}</div>
          <div>${escapeText(event.description)}</div>
        </li>
      `,
    )
    .join("");

  sceneList.innerHTML = tickScenes
    .map(
      (scene) => `
        <li>
          <div class="time">时间步 ${scene.tick}</div>
          <div><strong>${escapeText(scene.title)}</strong></div>
          <div>${escapeText(scene.summary)}</div>
        </li>
      `,
    )
    .join("");

  if (!eventList.innerHTML) {
    eventList.innerHTML = `<li><div class="time">时间步 ${currentTick}</div><div>初始状态，暂无事件。</div></li>`;
  }
  if (!sceneList.innerHTML) {
    sceneList.innerHTML = `<li><div class="time">时间步 ${currentTick}</div><div>当前时刻没有被选中的叙事场景。</div></li>`;
  }
}

function circularLayout(ids, cx, cy, radius) {
  const result = {};
  ids.forEach((id, index) => {
    const angle = (Math.PI * 2 * index) / ids.length - Math.PI / 2;
    result[id] = {
      x: Math.round(cx + Math.cos(angle) * radius),
      y: Math.round(cy + Math.sin(angle) * radius),
    };
  });
  return result;
}

function signedClass(value) {
  return value >= 0 ? "relation-pos" : "relation-neg";
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function shortName(name) {
  if (name === "玩家使者") {
    return "玩家";
  }
  return name;
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
