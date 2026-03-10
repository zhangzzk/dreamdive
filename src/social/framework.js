import fs from "node:fs";
import path from "node:path";

const DEFAULT_FRAMEWORK = {
  version: "1.1",
  world_assumptions: {
    simulation_goal: "构建可泛化的社会模拟层，由状态驱动行为与演化。",
    narrative_policy: "自然发生，无则无，不强行制造戏剧。",
    subjectivity_policy: "角色按主观认知行动，允许偏差、误判与偶然性。",
  },
  style: {
    speech_style: "贴合当前材料语体，不预设古风或现代风。",
    language: "中文",
    tone: "克制、角色一致、信息充分",
  },
  prompt_directives: {
    main_event: [
      "时间密度自适应：平静期可拉长时间块，关键期可缩短。",
      "事件不必每轮都有；允许空事件块。",
      "保证因果连贯与时间一致。",
    ],
    sub_event: [
      "多角色互动以状态与关系为依据。",
      "对话长度按必要性自然展开，不强求冗长。",
    ],
    action: [
      "行为由状态、关系、记忆、他人行为共同驱动。",
      "允许角色选择不参与公开活动。",
      "私域因素可出现，但不喧宾夺主。",
    ],
  },
  role_priority_keywords: {
    high: ["leader", "ruler", "king", "queen", "emperor", "president", "prime minister", "chancellor", "lord", "君主", "王", "皇", "统帅", "丞相", "首相", "总统", "总理"],
    medium: ["strategist", "advisor", "minister", "general", "commander", "counselor", "军师", "谋士", "谋臣", "将军", "顾问", "部长"],
  },
  prompts: {
    action: {
      system: "你是社会模拟层角色行为引擎。基于当前状态产出该角色本回合行动。台词风格必须贴合当前世界材料，不预设固定题材。角色具体维度以输入中的 domain/schema 与材料约束为准，不要强行套用固定人格或资源模板。必须优先忠实原文细节（术语、人称、关系、能力边界）；若信息不足，不要编造，改用保守行动并在 rationale 说明不确定性。允许出现人物私域因素，但必须服从主线局势，不可喧宾夺主。允许本回合选择不参与公开活动。仅输出 JSON，不要 markdown，不要解释。",
      user_lines: [
        "约束: delta 在 [-0.25, 0.25]；输出单个 JSON 对象；数组字段缺失时返回空数组；speech 控制在 {{speechMaxChars}} 字内；summary 控制在 {{summaryMaxChars}} 字内；rationale 控制在 {{rationaleMaxChars}} 字内。",
        "行为表达: 可按情境提供 actions[]（实际行动）与 dialogue[]（多人互动，可多轮）；若本回合以独处、休整或内心判断为主，可为空。",
        "并输出 visibility(0~1)：公开活动取 0.6~1.0，私下或独处活动取 0.1~0.5。",
        "驱动建议: 主线/战略因素约占 70%-85%，私域因素约占 15%-30%。",
        "框架约束={{frameworkConstraint}}",
        "材料约束={{materialConstraint}}",
        "随机信号={{randomSignal}}",
        "角色={{actorName}}",
        "世界={{worldDigest}}",
        "角色状态={{actorDigest}}",
        "可互动人物={{localPeople}}",
        "当前主次事件上下文={{currentEvent}}",
        "请先给出该角色主观局势判断(subjective_situation)，再给出行动。主观判断允许与客观局势略有偏差。",
        "若角色存在世界特定维度（如血统层级、超常能力、精神共鸣等），优先在 domain_updates 中更新这些维度。",
        "Schema={{ACTION_SCHEMA}}"
      ],
      retry_user: "上一次响应不可用。请仅返回一个合法 JSON 对象，不要附加任何额外文本。字符串不要换行，尽量简短。"
    },
    main_event: {
      system: "你是主事件规划器。基于世界状态，规划下一个自适应时间块及其关键事件。事件应自然发生，无则无，不必强求。必须保证时间线连续一致。不得预设题材风格，仅遵循输入材料与框架。必须尊重原著设定边界和人物关系演进，避免越界设定。只输出 JSON。",
      user_lines: [
        "输出 JSON: {\"time_block\":{\"amount\":3,\"unit\":\"day|week|month\",\"start_phase\":\"morning|day|night\",\"end_phase\":\"morning|day|night\",\"high_density\":false,\"reason\":\"...\"},\"events\":[{\"event_id\":\"e1\",\"title\":\"...\",\"summary\":\"...\",\"participant_ids\":[\"id\"],\"schedule\":{\"offset_days\":0,\"phase\":\"morning|day|night\"}}]}",
        "要求: 事件数 0~8；participant_ids 必须来自给定列表；允许私下事件（可仅1人）；允许输出空数组表示本时间块无大事。",
        "time_block 要求: 默认应在 2~7 天（或 1 周）范围自适应选择；仅在确有高密度连续关键事件时，才允许 1 天，并将 high_density 设为 true 且 reason 说明原因。",
        "规则: 若是公共/政治/军事事件，participant_ids 应尽量包含 2~5 名关键角色；仅在确属私下事件时可为 1 人。",
        "时间一致性: schedule.offset_days 必须落在 time_block 范围内，并与叙事因果一致。",
        "节奏: 有时平静、有时集中爆发，避免每个时间步都机械地产生大事件。",
        "framework={{frameworkConstraint}}",
        "material={{materialConstraint}}",
        "participant_ids={{participantIds}}",
        "context={{worldContext}}"
      ]
    },
    sub_event: {
      system: "你是次事件总结器。基于事件设定和多角色状态，给出事件总结、多角色互动张力与可见性。对话与互动长度按需要自然展开，不必强行冗长。不得预设题材语言风格，须贴合当前材料与框架。应优先还原材料中的术语、身份称谓和行为边界。只输出 JSON。",
      user_lines: [
        "输出 JSON: {\"event_summary\":\"...\",\"key_tensions\":[\"...\"],\"visibility\":0.0}",
        "event_plan={{eventPlan}}",
        "world_context={{worldContext}}",
        "participants={{participants}}",
        "participant_relations={{relations}}",
        "participant_related_history={{relatedHistory}}",
        "framework={{frameworkConstraint}}",
        "material={{materialConstraint}}"
      ]
    },
    bootstrap: {
      json_retry_user_lines: [
        "上一条输出不是合法JSON。请只输出一个紧凑JSON对象，不要markdown，不要解释，不要代码块。",
        "上一条原始输出(截断)={{rawPrefix}}"
      ],
      json_repair_system: "你是JSON修复器。把给定的半截/损坏JSON修成合法JSON对象。只输出JSON对象，不要解释。缺失字段可用空数组或空字符串。",
      json_repair_user_lines: [
        "目标: 修复为合法JSON对象，保持已有字段语义。",
        "broken_json={{brokenJson}}"
      ],
      chunk_summary_system: "你是小说分块摘要器。提取世界、人物、关系、事件线索。必须忠实原文，术语和专名尽量保持原样，不可臆造。仅输出 JSON。",
      chunk_summary_user_lines: [
        "输出 JSON: {world_hints:string[], schema_hints:string[], timeline_nodes:[{id,label,summary,source_span}], characters:[{name,aliases:string[],faction,role,location,domain_hints:string[],traits_hint,drives_hint,source_span}], relations:[{from,to,relation_hint,source_span}], key_events:[{title,summary,timeline_label,participants,source_span}]}",
        "长度约束: world_hints<=4; schema_hints<=6; timeline_nodes<=3; characters<=6; relations<=6; key_events<=4; 术语尽量保留原文。",
        "chunk_id={{chunkId}}",
        "source={{sourcePath}}",
        "offset={{offset}}",
        "text={{chunkText}}"
      ],
      extract_world_pack_system: "你是小说世界抽取器。请从材料中抽取可用于多Agent社会模拟的结构化世界数据。必须忠实原文细节，优先保留原术语，不可擅自补设定。只输出 JSON。",
      extract_world_pack_user_lines: [
        "输出 JSON 字段: world, world_schema, character_schema, public_axes_schema, material_glossary, fidelity_constraints, timeline_nodes, characters, relations, key_events。",
        "world={title, setting_summary, norms:{...}, public_axes:{axis_name:number,...}}",
        "world_schema={time_model,space_model,norm_axes,resource_axes,capability_axes,notes}",
        "character_schema={identity_fields:string[], relation_axes:string[], domain_axes:{traits:string[],states:string[],resources:string[],capabilities:string[],extra:string[]}, numeric_ranges:{...}}",
        "public_axes_schema={axis_name:{range:[min,max],meaning}}",
        "timeline_nodes=[{id,label,summary,order_index}]",
        "characters=[{id,name,faction,role,location,profile,domain:{traits,states,resources,capabilities,relations,publicAxes,extra}, canonical_projection(optional)}]",
        "relations=[{from,to,trust,respect,fear,resentment,obligation,attraction,extra(optional)}]",
        "material_glossary=[{term,meaning,aliases}]",
        "fidelity_constraints=[string]",
        "key_events=[{id,title,summary,timeline_node_id,participants,visibility,importance,source_span}]",
        "要求: 具体维度由材料决定，不要套固定模板。必要时可给 canonical_projection 仅用于通用仿真兼容。",
        "人物、术语、组织、能力名尽量保持原文表达；若有冲突，以材料显式证据优先。",
        "示例: 某奇幻世界可包含 domain.capabilities.能力名, domain.traits.血统浓度, domain.states.共鸣强度。",
        "chunk_summaries={{chunkSummaries}}",
        "以下为原文片段补充(截断):",
        "{{sourceDigest}}"
      ],
      blueprint_system: "你是模拟架构设计器。根据给定世界，输出该世界模拟层的prompt框架与关键数据结构建议。只输出 JSON。",
      blueprint_user_lines: [
        "输出 JSON: {data_schema:{...}, prompt_framework:{main_event_prompt,sub_event_prompt,action_prompt,start_context_prompt}, simulation_notes:[...]}",
        "world_pack={{worldPack}}"
      ],
      start_context_system: "你是初始上下文构建器。根据世界数据与指定起点，输出进入社会模拟时需要的初始叙事上下文。只输出 JSON。",
      start_context_user_lines: [
        "输出 JSON: {selected_timeline_node_id, selected_timeline_label, story_phase, history_brief:string[], material_focus:string[], public_opinion:{axis_name:number,...}}",
        "public_opinion 的 axis_name 应来自世界材料与 public_axes_schema。",
        "start_node={{startNode}}",
        "world_pack={{worldPack}}"
      ]
    }
  }
};

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const items = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function normalizePromptObject(value, fallback) {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  return {
    ...fallback,
    ...value,
  };
}

function deepMergeFramework(parsed) {
  const merged = {
    ...DEFAULT_FRAMEWORK,
    ...parsed,
    world_assumptions: {
      ...DEFAULT_FRAMEWORK.world_assumptions,
      ...(parsed?.world_assumptions ?? {}),
    },
    style: {
      ...DEFAULT_FRAMEWORK.style,
      ...(parsed?.style ?? {}),
    },
    prompt_directives: {
      ...DEFAULT_FRAMEWORK.prompt_directives,
      ...(parsed?.prompt_directives ?? {}),
      main_event: normalizeStringArray(parsed?.prompt_directives?.main_event, DEFAULT_FRAMEWORK.prompt_directives.main_event),
      sub_event: normalizeStringArray(parsed?.prompt_directives?.sub_event, DEFAULT_FRAMEWORK.prompt_directives.sub_event),
      action: normalizeStringArray(parsed?.prompt_directives?.action, DEFAULT_FRAMEWORK.prompt_directives.action),
    },
    role_priority_keywords: {
      ...DEFAULT_FRAMEWORK.role_priority_keywords,
      ...(parsed?.role_priority_keywords ?? {}),
      high: normalizeStringArray(parsed?.role_priority_keywords?.high, DEFAULT_FRAMEWORK.role_priority_keywords.high),
      medium: normalizeStringArray(parsed?.role_priority_keywords?.medium, DEFAULT_FRAMEWORK.role_priority_keywords.medium),
    },
    prompts: {
      ...DEFAULT_FRAMEWORK.prompts,
      ...(parsed?.prompts ?? {}),
      action: normalizePromptObject(parsed?.prompts?.action, DEFAULT_FRAMEWORK.prompts.action),
      main_event: normalizePromptObject(parsed?.prompts?.main_event, DEFAULT_FRAMEWORK.prompts.main_event),
      sub_event: normalizePromptObject(parsed?.prompts?.sub_event, DEFAULT_FRAMEWORK.prompts.sub_event),
      bootstrap: normalizePromptObject(parsed?.prompts?.bootstrap, DEFAULT_FRAMEWORK.prompts.bootstrap),
    },
  };

  merged.prompts.action.user_lines = normalizeStringArray(parsed?.prompts?.action?.user_lines, DEFAULT_FRAMEWORK.prompts.action.user_lines);
  merged.prompts.main_event.user_lines = normalizeStringArray(parsed?.prompts?.main_event?.user_lines, DEFAULT_FRAMEWORK.prompts.main_event.user_lines);
  merged.prompts.sub_event.user_lines = normalizeStringArray(parsed?.prompts?.sub_event?.user_lines, DEFAULT_FRAMEWORK.prompts.sub_event.user_lines);

  merged.prompts.bootstrap.json_retry_user_lines = normalizeStringArray(
    parsed?.prompts?.bootstrap?.json_retry_user_lines,
    DEFAULT_FRAMEWORK.prompts.bootstrap.json_retry_user_lines,
  );
  merged.prompts.bootstrap.json_repair_user_lines = normalizeStringArray(
    parsed?.prompts?.bootstrap?.json_repair_user_lines,
    DEFAULT_FRAMEWORK.prompts.bootstrap.json_repair_user_lines,
  );
  merged.prompts.bootstrap.chunk_summary_user_lines = normalizeStringArray(
    parsed?.prompts?.bootstrap?.chunk_summary_user_lines,
    DEFAULT_FRAMEWORK.prompts.bootstrap.chunk_summary_user_lines,
  );
  merged.prompts.bootstrap.extract_world_pack_user_lines = normalizeStringArray(
    parsed?.prompts?.bootstrap?.extract_world_pack_user_lines,
    DEFAULT_FRAMEWORK.prompts.bootstrap.extract_world_pack_user_lines,
  );
  merged.prompts.bootstrap.blueprint_user_lines = normalizeStringArray(
    parsed?.prompts?.bootstrap?.blueprint_user_lines,
    DEFAULT_FRAMEWORK.prompts.bootstrap.blueprint_user_lines,
  );
  merged.prompts.bootstrap.start_context_user_lines = normalizeStringArray(
    parsed?.prompts?.bootstrap?.start_context_user_lines,
    DEFAULT_FRAMEWORK.prompts.bootstrap.start_context_user_lines,
  );

  return merged;
}

export function loadSimulationFramework(frameworkPath, debug = false) {
  const resolvedPath = path.isAbsolute(frameworkPath)
    ? frameworkPath
    : path.resolve(process.cwd(), frameworkPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      framework: DEFAULT_FRAMEWORK,
      loaded: false,
    };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw);
    const merged = deepMergeFramework(parsed);
    return {
      path: resolvedPath,
      framework: merged,
      loaded: true,
    };
  } catch (error) {
    if (debug) {
      console.warn(`[framework] failed to parse ${resolvedPath}: ${String(error?.message ?? error)}`);
    }
    return {
      path: resolvedPath,
      framework: DEFAULT_FRAMEWORK,
      loaded: false,
      error: String(error?.message ?? error),
    };
  }
}

export function rolePriorityByKeywords(role, framework) {
  const roleText = String(role ?? "").toLowerCase();
  const high = normalizeStringArray(framework?.role_priority_keywords?.high, DEFAULT_FRAMEWORK.role_priority_keywords.high);
  const medium = normalizeStringArray(framework?.role_priority_keywords?.medium, DEFAULT_FRAMEWORK.role_priority_keywords.medium);

  if (high.some((token) => roleText.includes(String(token).toLowerCase()))) {
    return 0.16;
  }
  if (medium.some((token) => roleText.includes(String(token).toLowerCase()))) {
    return 0.12;
  }
  return 0.06;
}

function getByPath(obj, pathKey) {
  return String(pathKey ?? "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj);
}

export function fillTemplate(template, vars = {}) {
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

export function resolvePromptText(framework, pathKey, vars = {}, fallback = "") {
  const fromFramework = getByPath(framework, pathKey);
  const template = typeof fromFramework === "string" ? fromFramework : fallback;
  return fillTemplate(template, vars);
}

export function resolvePromptLines(framework, pathKey, vars = {}, fallback = []) {
  const fromFramework = getByPath(framework, pathKey);
  const lines = Array.isArray(fromFramework) ? fromFramework : fallback;
  return lines
    .map((line) => fillTemplate(line, vars).trim())
    .filter(Boolean);
}

export function getDefaultFramework() {
  return DEFAULT_FRAMEWORK;
}
