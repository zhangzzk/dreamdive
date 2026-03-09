import { createWorldState } from "../model.js";

const AGENT_IDS = [
  "cao-cao",
  "cao-ren",
  "sun-quan",
  "zhou-yu",
  "lu-su",
  "huang-gai",
  "lv-meng",
  "gan-ning",
  "cheng-pu",
  "zhang-zhao",
  "liu-bei",
  "zhuge-liang",
  "pang-tong",
];

const RELATION_FIELDS = ["trust", "respect", "fear", "resentment", "obligation", "attraction"];

function relationBase() {
  return { trust: 0, respect: 0, fear: 0, resentment: 0, obligation: 0, attraction: 0 };
}

function createRelationMap(overridesBySource = {}) {
  const map = {};
  for (const source of AGENT_IDS) {
    const row = {};
    for (const target of AGENT_IDS) {
      if (source === target) {
        continue;
      }
      const base = relationBase();
      const override = overridesBySource[source]?.[target] ?? {};
      row[target] = {
        trust: override.trust ?? base.trust,
        respect: override.respect ?? base.respect,
        fear: override.fear ?? base.fear,
        resentment: override.resentment ?? base.resentment,
        obligation: override.obligation ?? base.obligation,
        attraction: override.attraction ?? base.attraction,
      };
    }
    map[source] = row;
  }
  return map;
}

function emptyBeliefs() {
  return [];
}

const relationOverrides = createRelationMap({
  "cao-cao": {
    "cao-ren": { trust: 0.78, respect: 0.72, obligation: 0.65 },
    "sun-quan": { trust: -0.55, fear: 0.08, resentment: 0.4 },
    "liu-bei": { trust: -0.62, resentment: 0.5, fear: 0.1 },
  },
  "sun-quan": {
    "zhou-yu": { trust: 0.78, respect: 0.85, obligation: 0.45 },
    "lu-su": { trust: 0.82, respect: 0.74, obligation: 0.4 },
    "zhang-zhao": { trust: 0.56, respect: 0.72, obligation: 0.42 },
    "liu-bei": { trust: 0.12, respect: 0.32, fear: 0.12 },
  },
  "zhou-yu": {
    "sun-quan": { trust: 0.82, respect: 0.9, obligation: 0.48 },
    "lu-su": { trust: 0.46, respect: 0.62 },
    "zhang-zhao": { trust: -0.35, resentment: 0.55, respect: 0.18 },
    "liu-bei": { trust: -0.22, resentment: 0.42, fear: 0.2 },
    "zhuge-liang": { trust: -0.28, respect: 0.35, resentment: 0.38 },
  },
  "lu-su": {
    "sun-quan": { trust: 0.86, respect: 0.76, obligation: 0.4 },
    "zhou-yu": { trust: 0.6, respect: 0.72 },
    "liu-bei": { trust: 0.56, respect: 0.48 },
    "zhuge-liang": { trust: 0.52, respect: 0.64 },
  },
  "zhang-zhao": {
    "sun-quan": { trust: 0.58, respect: 0.72, obligation: 0.42 },
    "zhou-yu": { trust: -0.32, resentment: 0.62, respect: 0.18 },
    "liu-bei": { trust: -0.46, resentment: 0.6, fear: 0.1 },
  },
  "liu-bei": {
    "zhuge-liang": { trust: 0.9, respect: 0.92, obligation: 0.62 },
    "sun-quan": { trust: 0.22, respect: 0.44, fear: 0.18 },
    "zhou-yu": { trust: -0.24, fear: 0.3, resentment: 0.2 },
    "cao-cao": { trust: -0.7, resentment: 0.68, fear: 0.2 },
  },
  "zhuge-liang": {
    "liu-bei": { trust: 0.94, respect: 0.95, obligation: 0.7 },
    "sun-quan": { trust: 0.3, respect: 0.45 },
    "zhou-yu": { trust: -0.15, respect: 0.58, fear: 0.18 },
    "cao-cao": { trust: -0.62, fear: 0.12, resentment: 0.35 },
  },
});

const profileOverrides = {
  "cao-cao": {
    hobbies: ["校阅兵书", "夜读史策"],
    dislikes: ["优柔寡断", "军令不行"],
    family: "北方宗族盘根，需稳宗族与朝局",
    hiddenWorry: "久战疫病与水土不服削弱北军",
    habit: "夜半独断军务，常亲改文牍",
    privateGoal: "以最小代价一统南北",
  },
  "cao-ren": {
    hobbies: ["操练前锋", "检阅营垒"],
    dislikes: ["无备冒进", "临阵失纪"],
    family: "曹氏宗亲，家门荣辱与军功相连",
    hiddenWorry: "担心前线失守拖累中军部署",
    habit: "先查地势再定兵位",
    privateGoal: "守住江陵，稳固魏军桥头",
  },
  "sun-quan": {
    hobbies: ["校阅朝议", "观江防图"],
    dislikes: ["朝堂党争", "被动受制"],
    family: "承父兄基业，须顾宗室与江东士族",
    hiddenWorry: "主战主和分裂可能动摇统御",
    habit: "大事先问群臣再拍板",
    privateGoal: "保江东根本并借盟破局",
  },
  "zhou-yu": {
    hobbies: ["操舟演阵", "抚琴静心"],
    dislikes: ["军令掣肘", "外臣掣政"],
    family: "士族门第，重名声与军功并立",
    hiddenWorry: "担心联刘后吴国主导权旁落",
    habit: "先设局后亮牌",
    privateGoal: "以赤壁一战定江东主势",
  },
  "lu-su": {
    hobbies: ["研读地志", "访谈使节"],
    dislikes: ["短视内耗", "轻弃盟约"],
    family: "族中望其以文治稳局",
    hiddenWorry: "联盟一破，吴国将独承曹军锋芒",
    habit: "先算长期利害再谈当下得失",
    privateGoal: "促成并维持孙刘联盟",
  },
  "huang-gai": {
    hobbies: ["整训水卒", "巡检战船"],
    dislikes: ["纸上空谈", "贪功轻兵"],
    family: "老将家声，重军中口碑",
    hiddenWorry: "担心奇谋失败致军心震荡",
    habit: "先苦练后出战",
    privateGoal: "以非常手段打破魏军优势",
  },
  "lv-meng": {
    hobbies: ["习兵法", "夜读经史"],
    dislikes: ["轻敌", "懈怠"],
    family: "寒门出身，望以功业立名",
    hiddenWorry: "担心资历浅而难服众",
    habit: "事前反复推演",
    privateGoal: "在大战中确立主将地位",
  },
  "gan-ning": {
    hobbies: ["训练突击", "检修甲兵"],
    dislikes: ["畏战", "拖沓军令"],
    family: "旧部与新军并存，需稳人心",
    hiddenWorry: "担心猛进失援致折损",
    habit: "临战先请为前锋",
    privateGoal: "以战功洗旧名，争军中重位",
  },
  "cheng-pu": {
    hobbies: ["整肃军纪", "复盘旧战"],
    dislikes: ["轻佻冒进", "失礼越序"],
    family: "宿将门风，重稳健持重",
    hiddenWorry: "担心新旧将领磨合不畅",
    habit: "议事偏重先守后攻",
    privateGoal: "护住主力，确保大战可持久",
  },
  "zhang-zhao": {
    hobbies: ["典章考据", "议礼修文"],
    dislikes: ["冒险赌战", "外来牵制"],
    family: "江东士族领袖之一，顾及士林态度",
    hiddenWorry: "担心大战失利动摇江东政基",
    habit: "凡事先问礼法与后果",
    privateGoal: "保社稷与士族秩序不坠",
  },
  "liu-bei": {
    hobbies: ["访贤问策", "抚军恤士"],
    dislikes: ["背盟失信", "弃民保身"],
    family: "宗亲名分与流亡旧部皆需安顿",
    hiddenWorry: "担心寄身盟友而失自主",
    habit: "先安人心再图战局",
    privateGoal: "借盟立足并重建根基",
  },
  "zhuge-liang": {
    hobbies: ["观天候", "布算筹略"],
    dislikes: ["短策躁进", "无据臆断"],
    family: "需护刘备集团长期生存空间",
    hiddenWorry: "担心吴蜀互疑削弱抗曹大局",
    habit: "先定框架后推细节",
    privateGoal: "以最小代价促成稳定联盟",
  },
  "pang-tong": {
    hobbies: ["评人物", "推演奇策"],
    dislikes: ["拘泥成法", "错失战机"],
    family: "寄望其以智略建功立名",
    hiddenWorry: "担心被忽视导致策略难落地",
    habit: "先抛大胆方案再补执行细节",
    privateGoal: "在大战前证明其谋略价值",
  },
};

function agentBlueprints() {
  return [
    {
      id: "cao-cao",
      name: "曹操",
      identity: { origin: "沛国", faction: "魏", socialClass: "君主", role: "丞相", location: "江陵北岸大营" },
      traits: { ambition: 0.96, prudence: 0.64, impulsiveness: 0.35, empathy: 0.08, pride: 0.82, loyalty: 0.56, ruthlessness: 0.92 },
      drives: { survival: 0.72, power: 0.98, status: 0.9, wealth: 0.42, belonging: 0.25, morality: 0.06, desire: 0.2, revenge: 0.36 },
      internalState: { mood: 0.18, stress: 0.45, fatigue: 0.22, confidence: 0.86 },
      resources: { money: 520, troops: 220000, influence: 0.99, informationAccess: 0.88, time: 1 },
    },
    {
      id: "cao-ren",
      name: "曹仁",
      identity: { origin: "沛国", faction: "魏", socialClass: "武将", role: "前锋统帅", location: "江陵前沿" },
      traits: { ambition: 0.72, prudence: 0.6, impulsiveness: 0.46, empathy: 0.1, pride: 0.68, loyalty: 0.9, ruthlessness: 0.7 },
      drives: { survival: 0.74, power: 0.72, status: 0.7, wealth: 0.2, belonging: 0.45, morality: 0.14, desire: 0.15, revenge: 0.25 },
      internalState: { mood: 0.08, stress: 0.5, fatigue: 0.24, confidence: 0.7 },
      resources: { money: 90, troops: 38000, influence: 0.7, informationAccess: 0.55, time: 1 },
    },
    {
      id: "sun-quan",
      name: "孙权",
      identity: { origin: "江东", faction: "吴", socialClass: "君主", role: "吴主", location: "柴桑议政厅" },
      traits: { ambition: 0.8, prudence: 0.76, impulsiveness: 0.22, empathy: 0.24, pride: 0.52, loyalty: 0.76, ruthlessness: 0.44 },
      drives: { survival: 0.92, power: 0.84, status: 0.72, wealth: 0.36, belonging: 0.6, morality: 0.22, desire: 0.18, revenge: 0.3 },
      internalState: { mood: 0.12, stress: 0.58, fatigue: 0.2, confidence: 0.64 },
      resources: { money: 360, troops: 82000, influence: 0.95, informationAccess: 0.86, time: 1 },
    },
    {
      id: "zhou-yu",
      name: "周瑜",
      identity: { origin: "庐江", faction: "吴", socialClass: "士族", role: "都督", location: "柴桑军议厅" },
      traits: { ambition: 0.88, prudence: 0.56, impulsiveness: 0.34, empathy: 0.1, pride: 0.86, loyalty: 0.85, ruthlessness: 0.52 },
      drives: { survival: 0.7, power: 0.82, status: 0.88, wealth: 0.22, belonging: 0.48, morality: 0.1, desire: 0.12, revenge: 0.32 },
      internalState: { mood: 0.18, stress: 0.54, fatigue: 0.18, confidence: 0.76 },
      resources: { money: 110, troops: 42000, influence: 0.9, informationAccess: 0.8, time: 1 },
    },
    {
      id: "lu-su",
      name: "鲁肃",
      identity: { origin: "东城", faction: "吴", socialClass: "士族", role: "谋臣", location: "柴桑外事府" },
      traits: { ambition: 0.62, prudence: 0.86, impulsiveness: 0.1, empathy: 0.56, pride: 0.22, loyalty: 0.86, ruthlessness: 0.12 },
      drives: { survival: 0.74, power: 0.46, status: 0.4, wealth: 0.2, belonging: 0.78, morality: 0.62, desire: 0.08, revenge: 0.06 },
      internalState: { mood: 0.26, stress: 0.34, fatigue: 0.14, confidence: 0.66 },
      resources: { money: 70, troops: 6000, influence: 0.68, informationAccess: 0.86, time: 1 },
    },
    {
      id: "huang-gai",
      name: "黄盖",
      identity: { origin: "零陵", faction: "吴", socialClass: "武将", role: "先锋将", location: "江东水军营" },
      traits: { ambition: 0.58, prudence: 0.66, impulsiveness: 0.4, empathy: 0.18, pride: 0.64, loyalty: 0.9, ruthlessness: 0.65 },
      drives: { survival: 0.76, power: 0.54, status: 0.68, wealth: 0.16, belonging: 0.62, morality: 0.3, desire: 0.1, revenge: 0.2 },
      internalState: { mood: 0.06, stress: 0.46, fatigue: 0.24, confidence: 0.72 },
      resources: { money: 45, troops: 12000, influence: 0.58, informationAccess: 0.5, time: 1 },
    },
    {
      id: "lv-meng",
      name: "吕蒙",
      identity: { origin: "汝南", faction: "吴", socialClass: "武将", role: "偏将", location: "江东水军营" },
      traits: { ambition: 0.7, prudence: 0.7, impulsiveness: 0.34, empathy: 0.14, pride: 0.6, loyalty: 0.82, ruthlessness: 0.58 },
      drives: { survival: 0.8, power: 0.62, status: 0.7, wealth: 0.2, belonging: 0.56, morality: 0.22, desire: 0.08, revenge: 0.16 },
      internalState: { mood: 0.08, stress: 0.42, fatigue: 0.2, confidence: 0.68 },
      resources: { money: 55, troops: 14000, influence: 0.55, informationAccess: 0.52, time: 1 },
    },
    {
      id: "gan-ning",
      name: "甘宁",
      identity: { origin: "巴郡", faction: "吴", socialClass: "武将", role: "折冲都尉", location: "江东前线水寨" },
      traits: { ambition: 0.68, prudence: 0.48, impulsiveness: 0.62, empathy: 0.1, pride: 0.72, loyalty: 0.76, ruthlessness: 0.74 },
      drives: { survival: 0.66, power: 0.64, status: 0.78, wealth: 0.15, belonging: 0.52, morality: 0.14, desire: 0.12, revenge: 0.24 },
      internalState: { mood: 0.14, stress: 0.5, fatigue: 0.26, confidence: 0.74 },
      resources: { money: 35, troops: 9000, influence: 0.52, informationAccess: 0.45, time: 1 },
    },
    {
      id: "cheng-pu",
      name: "程普",
      identity: { origin: "右北平", faction: "吴", socialClass: "武将", role: "老将", location: "柴桑军议厅" },
      traits: { ambition: 0.5, prudence: 0.78, impulsiveness: 0.2, empathy: 0.18, pride: 0.48, loyalty: 0.88, ruthlessness: 0.4 },
      drives: { survival: 0.78, power: 0.5, status: 0.52, wealth: 0.16, belonging: 0.58, morality: 0.3, desire: 0.05, revenge: 0.12 },
      internalState: { mood: 0.05, stress: 0.38, fatigue: 0.3, confidence: 0.62 },
      resources: { money: 40, troops: 10000, influence: 0.5, informationAccess: 0.5, time: 1 },
    },
    {
      id: "zhang-zhao",
      name: "张昭",
      identity: { origin: "彭城", faction: "吴", socialClass: "士族", role: "朝臣元老", location: "柴桑议政厅" },
      traits: { ambition: 0.46, prudence: 0.9, impulsiveness: 0.08, empathy: 0.1, pride: 0.72, loyalty: 0.66, ruthlessness: 0.54 },
      drives: { survival: 0.84, power: 0.42, status: 0.56, wealth: 0.3, belonging: 0.44, morality: 0.34, desire: 0.04, revenge: 0.14 },
      internalState: { mood: -0.08, stress: 0.48, fatigue: 0.18, confidence: 0.6 },
      resources: { money: 100, troops: 1000, influence: 0.82, informationAccess: 0.9, time: 1 },
    },
    {
      id: "liu-bei",
      name: "刘备",
      identity: { origin: "涿郡", faction: "蜀", socialClass: "君主", role: "左将军", location: "夏口营寨" },
      traits: { ambition: 0.76, prudence: 0.72, impulsiveness: 0.24, empathy: 0.62, pride: 0.38, loyalty: 0.92, ruthlessness: 0.34 },
      drives: { survival: 0.86, power: 0.72, status: 0.68, wealth: 0.24, belonging: 0.84, morality: 0.7, desire: 0.08, revenge: 0.26 },
      internalState: { mood: 0.1, stress: 0.62, fatigue: 0.28, confidence: 0.56 },
      resources: { money: 80, troops: 30000, influence: 0.78, informationAccess: 0.66, time: 1 },
    },
    {
      id: "zhuge-liang",
      name: "诸葛亮",
      identity: { origin: "琅琊", faction: "蜀", socialClass: "士族", role: "军师", location: "柴桑外事馆" },
      traits: { ambition: 0.74, prudence: 0.96, impulsiveness: 0.04, empathy: 0.36, pride: 0.42, loyalty: 0.94, ruthlessness: 0.28 },
      drives: { survival: 0.78, power: 0.68, status: 0.6, wealth: 0.18, belonging: 0.72, morality: 0.62, desire: 0.06, revenge: 0.18 },
      internalState: { mood: 0.16, stress: 0.44, fatigue: 0.16, confidence: 0.86 },
      resources: { money: 65, troops: 5000, influence: 0.84, informationAccess: 0.94, time: 1 },
    },
    {
      id: "pang-tong",
      name: "庞统",
      identity: { origin: "襄阳", faction: "蜀", socialClass: "士族", role: "谋士", location: "江陵周边" },
      traits: { ambition: 0.68, prudence: 0.7, impulsiveness: 0.18, empathy: 0.2, pride: 0.46, loyalty: 0.7, ruthlessness: 0.36 },
      drives: { survival: 0.6, power: 0.64, status: 0.58, wealth: 0.14, belonging: 0.46, morality: 0.24, desire: 0.08, revenge: 0.1 },
      internalState: { mood: 0.06, stress: 0.4, fatigue: 0.22, confidence: 0.62 },
      resources: { money: 40, troops: 0, influence: 0.48, informationAccess: 0.72, time: 1 },
    },
  ];
}

function withRelations(agents) {
  return agents.map((agent) => ({
    ...agent,
    beliefs: emptyBeliefs(),
    relations: relationOverrides[agent.id],
    profile: profileOverrides[agent.id] ?? {
      hobbies: [],
      dislikes: [],
      family: "",
      hiddenWorry: "",
      habit: "",
      privateGoal: "",
    },
  }));
}

export function createRedCliffInitialState() {
  return createWorldState({
    id: "red-cliff-sandbox",
    title: "赤壁战前社会模拟沙盘",
    time: { day: 1, phase: "morning", tick: 0 },
    space: {
      nodes: ["江陵北岸大营", "柴桑议政厅", "柴桑军议厅", "江东水军营", "夏口营寨", "江面前线"],
      edges: [
        { from: "江陵北岸大营", to: "江面前线", cost: 1 },
        { from: "柴桑议政厅", to: "柴桑军议厅", cost: 1 },
        { from: "柴桑军议厅", to: "江东水军营", cost: 1 },
        { from: "夏口营寨", to: "柴桑外事馆", cost: 1 },
      ],
    },
    norms: {
      honorCulture: 0.84,
      hierarchyRigidity: 0.78,
      punishmentForBetrayal: 0.88,
      genderRestrictions: 0.72,
    },
    publicOpinion: {
      legitimacy: 0.6,
      alliancePressure: 0.7,
      courtSuspicion: 0.38,
      morale: 0.55,
    },
    metadata: {
      scenario: "赤壁之战",
      layer: "social-simulation-only",
      storyPhase: "赤壁决战前三日，孙刘联盟尚未完全稳固，曹军压境。",
      timeline: {
        era: "建安十三年冬",
        startMonthIndex: 9,
        daysPerMonth: 30,
        monthNames: ["十月", "十一月", "十二月", "正月", "二月"],
        monthLabel: "十月",
      },
      historyBrief: [
        "曹操南下后占据荆州，水陆并进威逼江东。",
        "孙权朝堂主战主和分裂，鲁肃力主联刘抗曹。",
        "刘备败走后暂驻夏口，遣诸葛亮赴吴促成联盟。",
      ],
      debug: { decisions: [] },
      relationFields: RELATION_FIELDS,
    },
    agents: withRelations(agentBlueprints()),
    eventLog: [],
    sceneLog: [],
  });
}
