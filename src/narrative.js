export function interpretEventsAsScenes(events) {
  return events
    .filter((event) => event.importance >= 0.55)
    .map((event) => ({
      tick: event.tick,
      title: buildSceneTitle(event),
      summary: buildSceneSummary(event),
      participants: event.participants,
      tags: deriveTags(event),
    }));
}

function buildSceneTitle(event) {
  if (event.type === "proposal") {
    return "联盟压力升高";
  }
  if (event.type === "rumor") {
    return "流言在柴桑扩散";
  }
  if (event.type === "debate") {
    return "朝堂派系冲突";
  }
  return "社会关系转折点";
}

function buildSceneSummary(event) {
  if (event.type === "proposal") {
    return `${event.actor}推动${event.target}采取协同行动，双方信任与义务感发生变化。`;
  }
  if (event.type === "rumor") {
    return `${event.actor}传播有关“${event.subject}”的说法，改变了朝堂中的信心与猜疑。`;
  }
  if (event.type === "debate") {
    return `${event.actor}在公开场合挑战${event.target}，压力上升，派系边界更清晰。`;
  }
  return event.description;
}

function deriveTags(event) {
  if (event.type === "proposal") {
    return ["alliance", "politics"];
  }
  if (event.type === "rumor") {
    return ["information", "trust"];
  }
  if (event.type === "debate") {
    return ["conflict", "court"];
  }
  return ["world"];
}
