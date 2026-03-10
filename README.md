# AI 社会世界模拟器

当前项目聚焦：**社会模拟层（Social Simulation Layer）**。

本仓库支持从任意文本材料（小说、设定集、笔记）自动抽取世界与角色数据库，并在该数据库上进行 LLM 驱动的多角色社会演化模拟。

## 当前能力

- 仅做社会模拟层（暂不包含玩家交互层、叙事展示层）
- 角色行为由 LLM 基于状态、关系、记忆、上下文生成
- 支持分层编排：主事件规划 + 次事件总结 + 角色行动
- 支持通用世界维度（`domain`），不再绑定固定题材字段
- 支持多模型配置、主备自动切换（仅在超时/报错时切换）
- 支持完整 Prompt/原始输出追踪（Debug Trace）

---

## 快速开始

### 1) 安装与配置

```bash
cp .env.example .env.local
# 编辑 .env.local，填入真实 API Key
```

### 2) 启动模拟

```bash
npm start
```

启动后会打印：
- API Key 是否生效（脱敏）
- endpoint / model / temperature
- orchestration 模式
- SQLite 路径
- 历史输出文件路径
- LLM trace 目录（开启时）

### 3) Debug 模式

```bash
DEBUG_MODE=1 npm start
```

Debug 模式下可查看：
- 决策驱动因素
- 角色行动与对话
- 完整 prompt 与原始 LLM 输出（开启 trace 时）

---

## 运行参数（核心）

- `SIM_STEPS`：模拟步数
- `SIM_ORCHESTRATION_MODE=hierarchical`：主事件 + 次事件 + 角色行动
- `SIM_LLM_CONCURRENCY`：LLM 并发
- `SIM_DB_PATH`：SQLite 数据库路径
- `SIM_FRAMEWORK_FILE`：模拟框架文件（默认 `config/simulation-framework.json`）
- `SIM_TRACE_LLM_IO=1`：保存完整请求/响应 trace
- `SIM_TRACE_DIR`：trace 根目录
- `SIM_HISTORY_DIR`：历史输出目录

随机性与可复现：
- `SIM_RANDOM_SEED`：随机种子
- `SIM_DECISION_NOISE`：说服/判断随机扰动
- `SIM_BATTLE_NOISE`：冲突结果随机扰动

---

## 从文本自动构建世界（Bootstrap）

### 通用模式（推荐）

```bash
SIM_SOURCE_FILES=/abs/path/novel.txt,/abs/path/worldbook,/abs/path/notes.md \
SIM_START_NODE=chapter-12 \
npm start
```

`SIM_SOURCE_FILES` 支持文件和目录，支持扩展名：
`.txt .md .markdown .json .yaml .yml .csv .tsv .html .htm`

Bootstrap 流程：
1. 分块摘要材料（世界/人物/关系/事件线索）
2. 抽取结构化世界包（schema + 角色 + 关系 + 事件）
3. 生成模拟蓝图
4. 根据起始节点构建初始上下文
5. 写入 SQLite，并进入模拟

### 仅做抽取（不跑模拟）

```bash
SIM_SOURCE_FILES=/abs/path/novel-dir \
SIM_BOOTSTRAP_ONLY=1 \
npm start
```

### 缓存

- `SIM_BOOTSTRAP_CACHE=1`：同材料复用抽取结果，节省 token

---

## 模型配置（多 Provider）

支持 OpenAI 兼容接口与多 profile：
- `LLM_PROFILE_1_* ... LLM_PROFILE_5_*`
- `LLM_PROFILE_PICK`：主 profile
- `LLM_FALLBACK_PROFILE_PICK`：备用 profile

主备切换策略：
- 仅当超时/HTTP错误/请求耗尽等失败时切到 fallback
- 正常请求始终使用主模型

可选模型参数：
- `LLM_MODEL`, `LLM_MODEL_1..3`, `LLM_MODEL_PICK`
- `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_RETRY_COUNT`, `LLM_RETRY_BACKOFF_MS`

---

## Prompt 与框架（可编辑）

默认文件：
- `config/simulation-framework.json`

可编辑内容：
- `world_assumptions`：模拟原则
- `style`：语言风格
- `prompt_directives`：主事件/次事件/行动层指导
- `role_priority_keywords`：角色优先级关键词
- `prompts`：全部 prompt 模板（action/main_event/sub_event/bootstrap）

当前框架强调：
- 由材料定义具体维度（schema/domain）
- 忠实原文细节与术语
- 信息不足时不编造，采取保守策略

---

## 可视化

```bash
npm run viz
```

用于查看模拟输出与关系网络（仓库中保留了早期可视化原型）。

---

## 测试

```bash
npm test
```

---

## 目录说明

- `src/socialMain.js`：启动入口
- `src/social/config.js`：运行配置加载
- `src/social/worldBootstrap.js`：材料抽取与世界构建
- `src/social/materialContext.js`：材料约束（术语表/忠实度/schema）
- `src/social/framework.js`：默认框架与 prompt 解析
- `src/social/hierarchicalEngine.js`：分层编排主循环
- `src/social/eventPlanner.js`：主事件/次事件规划
- `src/social/actionPlanner.js`：角色行动生成
- `src/social/stateUpdater.js`：状态更新与随机解析
- `src/social/reporter.js`：块级输出与最终摘要
- `src/social/historyDump.js`：历史记录导出
- `src/social/database.js`：SQLite 持久化
- `src/social/seedRedCliff.js`：内置示例场景（未启用材料模式时）

---

## 备注

- 若出现 `This operation was aborted`：降低并发、提高超时。
- 若出现输出截断：提高 `LLM_MAX_TOKENS`。
- 若端口冲突（如可视化 `4173`）：结束占用进程后重启。
