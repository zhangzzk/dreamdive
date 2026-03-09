function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function beliefPressure(agent) {
  return mean(
    agent.beliefs
      .filter((belief) => belief.topic === "联刘抗曹")
      .map((belief) => belief.confidence),
  );
}

function roleBias(role) {
  if (role.includes("都督")) {
    return { form_alliance: 0.2, spread_rumor: 0.2, challenge_rival: 0.25, observe: -0.1 };
  }
  if (role.includes("谋士")) {
    return { form_alliance: 0.25, spread_rumor: 0.05, challenge_rival: -0.05, observe: 0.08 };
  }
  if (role.includes("元老")) {
    return { form_alliance: -0.05, spread_rumor: 0.28, challenge_rival: 0.22, observe: 0.05 };
  }
  if (role.includes("主公")) {
    return { form_alliance: 0.22, spread_rumor: -0.05, challenge_rival: -0.03, observe: 0.04 };
  }
  return { form_alliance: 0.1, spread_rumor: 0.02, challenge_rival: 0.02, observe: 0.08 };
}

export function adviseGoalByPersona(world, agent, perceptions) {
  const playerTrust = agent.relations[world.metadata.playerId]?.trust ?? 0;
  const recentConflictCount = perceptions.recentEvents.filter(
    (event) => event.type === "rumor" || event.type === "debate",
  ).length;
  const rumorBelief = beliefPressure(agent);
  const bias = roleBias(agent.identity.role ?? "");

  const suggestions = {
    form_alliance:
      bias.form_alliance +
      0.32 * (world.publicOpinion.alliancePressure ?? 0) +
      0.14 * agent.traits.loyalty +
      0.12 * agent.drives.belonging -
      0.1 * agent.internalState.fatigue,
    spread_rumor:
      bias.spread_rumor +
      0.36 * Math.max(0, -playerTrust) +
      0.2 * rumorBelief +
      0.08 * recentConflictCount,
    challenge_rival:
      bias.challenge_rival +
      0.25 * agent.traits.pride +
      0.15 * agent.internalState.stress +
      0.1 * recentConflictCount,
    observe:
      bias.observe +
      0.2 * agent.traits.prudence +
      0.2 * agent.internalState.fatigue -
      0.08 * agent.drives.power,
  };

  const ranked = Object.entries(suggestions).sort((left, right) => right[1] - left[1]);
  const [goal, top] = ranked[0];
  return {
    scores: suggestions,
    recommendedGoal: top < 0.16 ? "observe" : goal,
    confidence: Math.max(0.05, Math.min(0.6, 0.2 + Math.abs(top - ranked[1][1]))),
    rationale: buildRationale(agent, ranked[0][0], playerTrust, rumorBelief),
  };
}

export async function adviseGoalByLLM(world, agent, perceptions, options = {}) {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = options.model ?? process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const baseUrl = options.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const endpoint = options.endpoint ?? process.env.LLM_ENDPOINT ?? "/chat/completions";
  const timeoutMs = options.timeoutMs ?? 1500;
  const prompt = buildPrompt(world, agent, perceptions);
  const systemPrompt = "你是历史社会模拟器的角色决策顾问，只输出 JSON。";

  try {
    const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 220,
      }),
    }, timeoutMs);

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const text = extractChatCompletionText(payload);
    const parsed = parseAdvice(text);
    if (!parsed) {
      return null;
    }

    return {
      scores: parsed.scores,
      recommendedGoal: parsed.goal,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      source: "llm",
    };
  } catch {
    return null;
  }
}

function buildRationale(agent, goal, playerTrust, rumorBelief) {
  if (goal === "spread_rumor") {
    return `${agent.name}对玩家信任偏低(${playerTrust.toFixed(2)}), 且流言相关信念增强(${rumorBelief.toFixed(2)}), 倾向舆论施压。`;
  }
  if (goal === "challenge_rival") {
    return `${agent.name}当前自尊与压力较高, 倾向在公开场合争夺话语权。`;
  }
  if (goal === "form_alliance") {
    return `${agent.name}在联盟压力背景下更倾向推动协同行动。`;
  }
  return `${agent.name}当前选择观望, 等待局势进一步明朗。`;
}

function buildPrompt(world, agent, perceptions) {
  const playerId = world.metadata.playerId;
  const playerTrust = agent.relations[playerId]?.trust ?? 0;
  const recent = perceptions.recentEvents.slice(-3).map((event) => ({
    type: event.type,
    actor: event.actor,
    target: event.target,
    description: event.description,
  }));

  return [
    "你是三国角色行动决策顾问。输出严格 JSON，不要 markdown。",
    "目标集合: form_alliance, spread_rumor, challenge_rival, observe。",
    "请基于角色特征、动机、关系、局势给每个目标评分(0到1)，并给出推荐目标与中文理由。",
    "JSON 格式:",
    '{"goal":"form_alliance","confidence":0.32,"rationale":"...","scores":{"form_alliance":0.7,"spread_rumor":0.2,"challenge_rival":0.1,"observe":0.05}}',
    `角色: ${agent.name}`,
    `身份: ${agent.identity.role}, 阵营: ${agent.identity.faction}`,
    `当前状态: stress=${agent.internalState.stress.toFixed(2)}, fatigue=${agent.internalState.fatigue.toFixed(2)}`,
    `对玩家信任: ${playerTrust.toFixed(2)}`,
    `公共舆情: alliancePressure=${(world.publicOpinion.alliancePressure ?? 0).toFixed(2)}, courtSuspicion=${(world.publicOpinion.courtSuspicion ?? 0).toFixed(2)}`,
    `最近事件: ${JSON.stringify(recent)}`,
  ].join("\n");
}

function parseAdvice(text) {
  const jsonText = firstJsonObject(text);
  if (!jsonText) {
    return null;
  }

  try {
    const data = JSON.parse(jsonText);
    const goalSet = new Set(["form_alliance", "spread_rumor", "challenge_rival", "observe"]);
    if (!goalSet.has(data.goal)) {
      return null;
    }
    const scores = {
      form_alliance: clamp01(Number(data.scores?.form_alliance ?? 0)),
      spread_rumor: clamp01(Number(data.scores?.spread_rumor ?? 0)),
      challenge_rival: clamp01(Number(data.scores?.challenge_rival ?? 0)),
      observe: clamp01(Number(data.scores?.observe ?? 0)),
    };
    return {
      goal: data.goal,
      confidence: clamp01(Number(data.confidence ?? 0.2)),
      rationale: String(data.rationale ?? "LLM 未提供理由。"),
      scores,
    };
  } catch {
    return null;
  }
}

function firstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function extractChatCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
