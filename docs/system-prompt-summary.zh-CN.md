<!-- docmeta
role: reference
layer: 2
parent: docs/INDEX.md
children: []
summary: 当前运行时 system-level prompt 各层的中文汇总，包括主会话、拼装优先级、附加层、agent、coordinator 与内部 side-query prompt
read_when:
  - 需要理解运行时到底有哪些会发给模型的系统级指令层
  - 修改 prompt 行为前，需要先定位对应层的源码入口
skip_when:
  - 只关心 OpenAI/Codex 后端实现计划，不关心 prompt 架构
source_of_truth:
  - src/constants/prompts.ts
  - src/utils/systemPrompt.ts
  - src/context.ts
  - src/utils/api.ts
  - src/coordinator/coordinatorMode.ts
  - src/tools/AgentTool/built-in
-->

# System Prompt 分层总览

## Scope

本文把当前仓库里**会实际暴露给模型的 system-level prompt 层**集中整理到一个地方。

覆盖范围包括：

- 主会话默认 system prompt
- 替换 / 覆盖 / 追加层
- 那些不直接存放在基础 prompt 字符串里、但仍会在请求时发给模型的运行时上下文
- 内建 agent 的 prompt 层
- coordinator / teammate 的附加层
- 内部 helper model call 使用的 side-query prompt

这份文档的目标是做**源码入口地图 + 架构总结**，而不是逐字抄录所有 prompt 全文。

**English version:** `docs/system-prompt-summary.md`

## 一个先记住的心智模型

这个仓库里并不存在一份单独、静态、唯一的“系统提示词”。

更准确地说，运行时会按层拼出模型最终可见的系统级指令面：

1. 先在 `src/constants/prompts.ts` 里通过 `getSystemPrompt(...)` 构建默认主 prompt
2. 再在 `src/utils/systemPrompt.ts` 里通过 `buildEffectiveSystemPrompt(...)` 做替换或扩展
3. 再通过 `appendSystemPrompt` 注入模式 / 会话级附加说明
4. 最后在真正发请求前，用 `appendSystemContext(...)` 追加 `systemContext`
5. 同时用 `prependUserContext(...)` 在消息前面插入一条合成的 meta user message

所以本仓库里说“system prompt”时，通常指的是一个更宽泛的**system-level prompt surface**，而不是某一个固定字符串。

## 第 1 层：主会话默认 system prompt

主入口：

- `src/constants/prompts.ts` → `getSystemPrompt(...)`

在标准路径下，`getSystemPrompt(...)` 返回的是一个 section 数组。

### 静态 sections

这些 section 构成默认 prompt 的主体：

| Section | 来源 | 作用 |
| --- | --- | --- |
| Intro | `getSimpleIntroSection()` | 助手身份、高层任务 framing、cyber/safety 与 URL 规则 |
| System | `getSimpleSystemSection()` | 工具权限模型、system reminder 处理、prompt injection 警告、上下文压缩 |
| Doing tasks | `getSimpleDoingTasksSection()` | 编码/执行任务行为、范围控制、验证要求、代码风格约束 |
| Executing actions with care | `getActionsSection()` | 高风险 / 难逆操作规则 |
| Using your tools | `getUsingYourToolsSection()` | 专用工具优先级、任务跟踪、并行 tool call、agent / skill 使用规则 |
| Tone and style | `getSimpleToneAndStyleSection()` | emoji、引用路径格式、tool call 前不要加冒号 |
| Output efficiency / Communicating with the user | `getOutputEfficiencySection()` | 面向用户的沟通风格 |

### 动态 sections

在静态块之后，prompt 会先插入一个 dynamic boundary marker，再去解析一组注册式动态 section。

相关源码：

- `src/constants/prompts.ts` → `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
- `src/constants/systemPromptSections.ts`
- `src/bootstrap/state.ts`（section cache 状态）

当前默认路径里的动态 section 包括：

- `session_guidance`
- `memory`
- `ant_model_override`
- `env_info_simple`
- `language`
- `output_style`
- `mcp_instructions`
- `scratchpad`
- `frc`
- `summarize_tool_results`
- `numeric_length_anchors`
- `token_budget`
- `brief`

### 为什么动态注册层重要

prompt 不是每回合都简单地重新拼成一个全新的、不透明的大字符串。

`src/constants/systemPromptSections.ts` 里定义了：

- `systemPromptSection(...)`：可缓存 section
- `DANGEROUS_uncachedSystemPromptSection(...)`：显式 cache-breaking section
- `resolveSystemPromptSections(...)`：解析并缓存 section
- `clearSystemPromptSections()`：在 `/clear` 和 `/compact` 时清理 section 状态

当前默认路径里，明确使用 uncached 的 section 是：

- `mcp_instructions`

它之所以不缓存，是因为 MCP server 可能在会话中途连接或断开。

## 第 2 层：主会话 prompt 的分支变体

`getSystemPrompt(...)` 在进入标准“静态 + 动态”拼装之前，还有几个关键分支。

### Simple mode

来源：

- `src/constants/prompts.ts` → `getSystemPrompt(...)`
- 环境开关：`CLAUDE_CODE_SIMPLE`

在 simple mode 下，默认 prompt 会退化成一段极简身份文本，再加上：

- 当前工作目录
- session start date

它**不会**使用完整的 section 化模板。

### Proactive / Kairos autonomous 分支

来源：

- `src/constants/prompts.ts` → `getSystemPrompt(...)` 内的 proactive 分支
- `src/constants/prompts.ts` → `getProactiveSection()`

当 proactive / Kairos 模式开启时，`getSystemPrompt(...)` 会返回另一套更偏 autonomous work 的默认 prompt，其中包括：

- autonomous-agent 身份文本
- system reminders
- memory prompt
- environment info
- language section
- MCP instructions
- scratchpad instructions
- function-result-clearing section
- tool-result summarization reminder
- proactive section 本身

`getProactiveSection()` 会进一步加入：

- 把 `<tick>` 当成唤醒信号
- 空闲时必须用 `Sleep`
- 第一次唤醒先问候用户
- 后续唤醒要主动寻找有价值的工作
- 少做过程 narration，多给简短 milestone update

## 第 3 层：有效 prompt 的选择顺序

主入口：

- `src/utils/systemPrompt.ts` → `buildEffectiveSystemPrompt(...)`

对主交互运行时来说，最终 prompt 的选择优先级是：

1. `overrideSystemPrompt` → 完全替换所有其他内容
2. coordinator prompt → coordinator mode 开启时替换普通主 prompt
3. main-thread agent prompt
   - 在 proactive mode 下：作为 `# Custom Agent Instructions` 追加
   - 否则：直接替换默认 prompt
4. `customSystemPrompt`
5. `getSystemPrompt(...)` 返回的默认 prompt
6. `appendSystemPrompt` → 除 `overrideSystemPrompt` 外，最后追加

### 这些值从哪来

CLI 侧入口包括：

- `src/main.tsx` → `--system-prompt`
- `src/main.tsx` → `--system-prompt-file`
- `src/main.tsx` → `--append-system-prompt`
- `src/main.tsx` → `--append-system-prompt-file`

### 一个重要细节：SDK / headless 路径并不完全相同

`src/QueryEngine.ts` 里还有一条单独的 SDK/headless 组装路径。

那条路径会拼：

- `customSystemPrompt` 或默认 system prompt
- 可选的 memory-mechanics prompt（当 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 存在时）
- `appendSystemPrompt`

它使用的是 `src/utils/queryContext.ts` 里的 `fetchSystemPromptParts(...)`。如果显式提供了 custom system prompt，这条路径会故意跳过默认 prompt 构建和 `systemContext` 获取。

因此，`buildEffectiveSystemPrompt(...)` 是主交互路径里最核心的选择函数，但它并不是整个仓库里唯一的 prompt 组装入口。

## 第 4 层：通过 appendSystemPrompt 收集的附加层

仓库里有多处逻辑会继续向 `appendSystemPrompt` 里塞附加说明。

### Teammate addendum

来源：

- `src/utils/swarm/teammatePromptAddendum.ts`
- `src/main.tsx` 调用点

这里会追加 `# Agent Teammate Communication`，强调 teammate 之间必须使用 `SendMessage`，普通文本对队友不可见。

### Claude in Chrome addenda

来源：

- `src/main.tsx`

如果启用了 Claude-in-Chrome 集成，运行时可能会在 `appendSystemPrompt` 前后追加和浏览器能力相关的提示 / hint。

### 启动路径里的 Proactive Mode addendum

来源：

- `src/main.tsx`

除了 `getSystemPrompt(...)` 里的 proactive 分支外，启动流程本身还可能再追加一段 `# Proactive Mode`，再次强调：

- 主动工作
- 先和用户打招呼
- 会收到周期性的 `<tick>`
- 无事可做时用 `Sleep`

### Assistant / Kairos addendum

来源：

- `src/main.tsx` 调用 `assistantModule.getAssistantSystemPromptAddendum()`

当前这个 fork 的可见源码里能看到调用点，但看不到完整 assistant 实现，因此应该把它视为一个真实存在的运行时 prompt 层，只是具体实现暂时不在当前可见范围内。

### Teammate 场景中的 Custom Agent Instructions

来源：

- `src/main.tsx`
- `src/utils/systemPrompt.ts`
- `src/utils/swarm/inProcessRunner.ts`

在一些 agent / teammate 场景里，自定义 agent prompt 会被包装成：

- `# Custom Agent Instructions`

然后追加到基础 prompt 后面，而不是直接替换。

## 第 5 层：请求发送前追加的 systemContext

主入口：

- `src/context.ts` → `getSystemContext()`
- `src/utils/api.ts` → `appendSystemContext(...)`
- `src/query.ts`

这一层特别容易被忽略，因为它**不在** `getSystemPrompt(...)` 返回的基础 prompt 数组里。

运行时实际做的是：

- `getSystemContext()` 生成一组系统提供的键值对
- `appendSystemContext(systemPrompt, systemContext)` 把它们转成 `key: value` 形式的文本
- `query.ts` 在真正调用模型前，把这些内容追加到 system prompt 末尾

当前 `systemContext` 主要包括：

- `gitStatus`：对话开始时的 git 快照，含 branch、status、recent commits、git user
- `cacheBreaker`：在 `BREAK_CACHE_COMMAND` 打开时用于调试的 cache-breaking 标记

所以模型最终看到的系统层内容，实际比 `getSystemPrompt(...)` 产生的 sections 更宽。

## 第 6 层：作为合成 meta user message 插入的 userContext

主入口：

- `src/context.ts` → `getUserContext()`
- `src/utils/api.ts` → `prependUserContext(...)`
- `src/query.ts`

这不是 system-role prompt，但它依然是一个**由系统注入、模型可见**的 instruction/context 层。

`prependUserContext(...)` 会构造一条合成的 meta user message，格式大致是：

- `<system-reminder>`
- 内含 `# claudeMd`、`# currentDate` 等命名块

当前 `userContext` 来源包括：

- `claudeMd`：聚合后的 CLAUDE.md / memory 类说明
- `currentDate`：当天日期

在真正发起 query 之前，运行时还可能继续往 user context 里追加内容：

- coordinator mode 会通过 `getCoordinatorUserContext(...)` 注入 `workerToolsContext`
- proactive mode 下，终端失焦时可能会加上 `terminalFocus`

所以模型最终接收到的是两部分：

- 一层 system-prompt stack
- 一条由系统伪造并前置的 user-context reminder

## 第 7 层：环境信息 prompt 层

相关源码：

- `src/constants/prompts.ts` → `computeSimpleEnvInfo(...)`
- `src/constants/prompts.ts` → `computeEnvInfo(...)`
- `src/constants/prompts.ts` → `enhanceSystemPromptWithEnvDetails(...)`

这里存在两种相关但不完全相同的环境信息格式。

### 主会话环境 section

`computeSimpleEnvInfo(...)` 用在默认主会话 prompt 里，内容可能包括：

- 主工作目录
- worktree 提示
- 是否 git repo
- additional working directories
- platform
- shell
- OS version
- 允许时展示 model description / knowledge cutoff
- provider/platform/fast-mode 说明

### Agent 环境增强 addendum

`enhanceSystemPromptWithEnvDetails(...)` 会在 agent 自身 prompt 后追加统一 agent 说明，包括：

- 因为 agent 的 bash 调用之间 cwd 会重置，所以必须使用绝对路径
- 最终报告里要给出绝对路径
- 避免 emoji
- tool call 前不要加冒号
- 通过 `computeEnvInfo(...)` 提供的完整环境信息
- 启用时还会加入 DiscoverSkills 相关 guidance

## 第 8 层：内建 agent prompt 层

内建 agent prompt 主要位于：

- `src/tools/AgentTool/built-in/`

当前可见的内建 agent prompt 包括：

| Agent | 来源 | 作用 |
| --- | --- | --- |
| `general-purpose` | `generalPurposeAgent.ts` | 通用 research / execution agent |
| `Plan` | `planAgent.ts` | 只读规划 / 架构 agent |
| `Explore` | `exploreAgent.ts` | 只读搜索 / 代码探索 agent |
| `verification` | `verificationAgent.ts` | 对抗式验证 agent，必须给出 PASS / FAIL / PARTIAL 证据 |
| `claude-code-guide` | `claudeCodeGuideAgent.ts` | 当前 fork 下用于解释 CLI + Codex / Responses API 文档 |
| `statusline-setup` | `statuslineSetup.ts` | 专门配置 status line 的 agent |

对应运行时路径：

- `src/tools/AgentTool/runAgent.ts`

agent 执行时的大致顺序是：

1. 取 agent 专属 system prompt
2. 如果失败，则回退到 `DEFAULT_AGENT_PROMPT`
3. 再把结果交给 `enhanceSystemPromptWithEnvDetails(...)` 统一增强

fallback 来源：

- `src/constants/prompts.ts` → `DEFAULT_AGENT_PROMPT`

## 第 9 层：coordinator prompt 层

主入口：

- `src/coordinator/coordinatorMode.ts` → `getCoordinatorSystemPrompt()`

当 coordinator mode 开启时，主线程不再走普通 coding prompt，而是变成一份 orchestration prompt。

这份 prompt 会把主线程定义成协调者，负责：

- 启动 worker
- 继续 / 停止 worker
- 把任务拆成 research / synthesis / implementation / verification
- 向用户汇总 worker 结果
- 有意识地管理并发

相关上下文层：

- `src/coordinator/coordinatorMode.ts` → `getCoordinatorUserContext()`

该函数会把 `workerToolsContext` 注入 `userContext`，告诉主线程 worker 有哪些工具、是否能用 scratchpad 等。

## 第 10 层：teammate / swarm addendum

主入口：

- `src/utils/swarm/teammatePromptAddendum.ts`

这是 team mode 下独立存在的一层 prompt。它强调的核心约束包括：

- 与队友沟通必须使用 `SendMessage`
- 普通文本对队友不可见
- 用户主要和 lead / 可见 agent 交互

它是那种非常典型的“并不属于默认主 prompt，但足以显著改变运行时行为”的 prompt 层。

## 第 11 层：内部 side-query / helper prompt

这些 prompt 不属于主会话 prompt，但同样是内部模型调用会使用的 system prompt。

| Prompt | 来源 | 用途 |
| --- | --- | --- |
| `SELECT_MEMORIES_SYSTEM_PROMPT` | `src/memdir/findRelevantMemories.ts` | 为当前 query 选择最相关的 memory 文件 |
| `TOOL_USE_SUMMARY_SYSTEM_PROMPT` | `src/services/toolUseSummary/toolUseSummaryGenerator.ts` | 给一批 tool calls 生成短摘要 label |
| `CRITIQUE_SYSTEM_PROMPT` | `src/cli/handlers/autoMode.ts` | 审核 auto-mode classifier 规则 |
| `AGENT_CREATION_SYSTEM_PROMPT` | `src/components/agents/generateAgent.ts` | 根据用户需求生成新的 agent 定义 |
| `SESSION_SEARCH_SYSTEM_PROMPT` | `src/utils/agenticSessionSearch.ts` | 在历史 session 中按相关性搜索 |
| permission explainer 里的 `SYSTEM_PROMPT` | `src/utils/permissions/permissionExplainer.ts` | 解释 shell 命令的作用、运行原因和风险 |

之所以值得单独列出来，是因为很多“改 prompt 行为”的需求，最终改动点其实并不在主会话 prompt，而是在这些 helper prompt。

## 修改 prompt 时的实用入口地图

如果你要改 prompt 行为，建议先明确自己改的是哪一层：

1. **默认主会话 prompt sections**
   - `src/constants/prompts.ts`
2. **替换 / 优先级逻辑**
   - `src/utils/systemPrompt.ts`
3. **system/user context 注入**
   - `src/context.ts`
   - `src/utils/api.ts`
   - `src/query.ts`
4. **coordinator / teammate 行为**
   - `src/coordinator/coordinatorMode.ts`
   - `src/utils/swarm/teammatePromptAddendum.ts`
5. **内建 agent prompt**
   - `src/tools/AgentTool/built-in/`
   - `src/tools/AgentTool/runAgent.ts`
6. **内部 helper prompt**
   - `src/memdir/`
   - `src/services/toolUseSummary/`
   - `src/components/agents/`
   - `src/utils/agenticSessionSearch.ts`
   - `src/utils/permissions/permissionExplainer.ts`

## 总结

当前运行时最准确的理解方式，是把“系统提示词”看成一套分层系统：

- 默认主会话 prompt sections
- simple / proactive 等分支变体
- 替换 / override / append 逻辑
- 启动期和运行期的 addendum
- 发送前追加的 `systemContext`
- 发送前前置的 `userContext`
- 专门的 agent / coordinator / teammate prompt
- side-query 使用的内部 helper prompt

用这个“分层 system-level prompt surface”的心智模型，最符合这个仓库当前的真实实现。