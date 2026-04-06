<!-- docmeta
role: reference
layer: 2
parent: docs/INDEX.md
children: []
summary: summary of the system-level prompt surfaces in this repository, including main-session, agent, coordinator, and internal side-query prompts
read_when:
  - need to understand which system prompts exist in the runtime
  - need to find where a prompt is defined or selected before editing prompt behavior
skip_when:
  - only need the canonical Codex integration implementation plan
source_of_truth:
  - src/constants/prompts.ts
  - src/utils/systemPrompt.ts
  - src/coordinator/coordinatorMode.ts
  - src/tools/AgentTool/built-in
-->

# System Prompt Summary

## Scope

本文总结当前仓库里会进入模型“系统层”的 prompt 面：

- 主会话默认 system prompt
- 主会话的覆盖 / 追加 / 模式分支
- 内建 agent 的 system prompt
- 团队 / 协调器附加 prompt
- 内部 side-query / 辅助任务 prompt

重点是说明**哪些 prompt 存在、何时生效、源码在哪**，而不是逐字转录全部正文。

## 主会话默认 system prompt

主入口在 `src/constants/prompts.ts:485` 的 `getSystemPrompt(...)`。

这个仓库的主 system prompt 不是一段固定字符串，而是运行时拼装出来的字符串数组。默认路径会组合以下 section：

| Section | 来源 | 作用 |
| --- | --- | --- |
| Intro | `src/constants/prompts.ts:215` `getSimpleIntroSection()` | 定义助手身份、通用安全约束、URL 使用限制 |
| System | `src/constants/prompts.ts:226` `getSimpleSystemSection()` | 定义工具权限、hook、`<system-reminder>`、上下文压缩等规则 |
| Doing tasks | `src/constants/prompts.ts:239` `getSimpleDoingTasksSection()` | 约束代码修改方式、验证要求、任务边界 |
| Executing actions with care | `src/constants/prompts.ts:296` `getActionsSection()` | 约束高风险和难逆操作 |
| Using your tools | `src/constants/prompts.ts:310` `getUsingYourToolsSection()` | 定义工具优先级、并行调用策略、任务跟踪要求 |
| Tone and style | `src/constants/prompts.ts:471` `getSimpleToneAndStyleSection()` | 约束回答风格、引用格式、emoji 等 |
| Output efficiency | `src/constants/prompts.ts:443` `getOutputEfficiencySection()` | 要求简洁直接、只在关键节点更新 |

默认路径下的动态 section 注册在 `src/constants/prompts.ts:530`，包括：

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

与环境信息相关的具体文本来自 `src/constants/prompts.ts:690` 的 `computeSimpleEnvInfo(...)`，会注入工作目录、git 状态、平台、shell、OS、模型/provider 说明等。

## 主会话 prompt 的选择优先级

最终主 prompt 的装配逻辑在 `src/utils/systemPrompt.ts:40` 的 `buildEffectiveSystemPrompt(...)`。

优先级如下：

1. `overrideSystemPrompt`：完全覆盖，来自 `--system-prompt` / `--system-prompt-file`
2. coordinator prompt：协调器模式启用时替换默认主 prompt
3. agent prompt：主线程 agent 启用时使用 agent 的 prompt
   - 在 proactive 模式下，agent prompt 不替换默认 prompt，而是以 `# Custom Agent Instructions` 形式追加
4. `customSystemPrompt`：用户自定义 system prompt
5. 默认主 system prompt：`getSystemPrompt(...)`
6. `appendSystemPrompt`：除 override 外，总是在最后追加

对应 CLI 入口在：

- `src/main.tsx:1454` `--system-prompt` / `--system-prompt-file`
- `src/main.tsx:1475` `--append-system-prompt` / `--append-system-prompt-file`

## 主会话的特殊分支

### 1. Simple mode

来源：`src/constants/prompts.ts:491`

当 `CLAUDE_CODE_SIMPLE=1` 时，主 prompt 退化成一段极简身份文本，加上当前目录和日期，不走完整默认模板。

### 2. Proactive mode

来源：

- `src/constants/prompts.ts:505`
- `src/constants/prompts.ts:902` `getProactiveSection()`

当 proactive / kairos 模式开启时，主 prompt 切到“autonomous agent”分支。这个分支强调：

- 通过 `<tick>` 驱动回合
- 空闲时必须调用 `Sleep`
- 首次 tick 先问候用户，不要擅自开工
- 后续 tick 要主动寻找有价值的工作
- 用户聚焦时更协作，离开时更自治

### 3. Coordinator mode

来源：

- `src/utils/systemPrompt.ts:61`
- `src/coordinator/coordinatorMode.ts:111`

协调器模式会用单独的 coordinator system prompt 替换默认 prompt。它把主线程定义为“调度者”，负责：

- 启动 / 继续 / 停止 workers
- 把 research / implementation / verification 分发给 workers
- 汇总 worker 结果并向用户汇报
- 决定什么时候复用已有 worker 上下文，什么时候新开 worker

### 4. Agent 环境增强 addendum

来源：`src/constants/prompts.ts:802` `enhanceSystemPromptWithEnvDetails(...)`

所有 subagent 在自身 system prompt 之后还会被追加一段通用说明，包括：

- Bash 调用之间 cwd 会重置，因此要求使用绝对路径
- 最终回复里应给出相关绝对路径
- 避免 emoji
- tool call 前不要写冒号
- 环境信息（cwd、平台、模型、OS 等）

### 5. Team / teammate addendum

来源：`src/utils/swarm/teammatePromptAddendum.ts:7`

团队模式会追加 `# Agent Teammate Communication` 段，强调：

- 与队友交流必须使用 `SendMessage`
- 直接写普通文本对队友不可见
- 用户主要和 team lead 互动

### 6. Assistant addendum hook

调用点在 `src/main.tsx:2320`，会从 `assistantModule.getAssistantSystemPromptAddendum()` 取一段附加 prompt。

当前工作区里可以确认调用点存在，但具体 addendum 定义不在当前可见的 `src/assistant/` 文件中。

## 内建 agent 的 system prompt

内建 agent prompt 主要位于 `src/tools/AgentTool/built-in/`。

| Agent | 来源 | 作用摘要 |
| --- | --- | --- |
| general-purpose | `src/tools/AgentTool/built-in/generalPurposeAgent.ts:18` | 通用研究/执行 agent，强调多文件搜索、分析与简洁汇报 |
| plan | `src/tools/AgentTool/built-in/planAgent.ts:13` | 只读规划 agent，严格禁止写文件，要求给出 implementation plan 和 critical files |
| explore | `src/tools/AgentTool/built-in/exploreAgent.ts:12` | 只读搜索 agent，专注快速文件/内容搜索与代码探索 |
| verification | `src/tools/AgentTool/built-in/verificationAgent.ts:9` | 对抗式验证 agent，不是“确认代码像是对的”，而是主动尝试把实现跑坏；必须给出带命令和输出证据的 PASS/FAIL/PARTIAL verdict |
| claude-code-guide | `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:26` | 当前 fork 下是 MIT / OpenAI Codex / OpenAI Responses API 指南 agent，优先本地源码，其次官方文档 |
| statusline-setup | `src/tools/AgentTool/built-in/statuslineSetup.ts:2` | 专门配置 status line 的 agent，包含 PS1 到 statusLine command 的转换规则 |

此外，agent 运行时的默认兜底 prompt 在 `src/constants/prompts.ts:800`：

- `DEFAULT_AGENT_PROMPT`

当 agent 的专用 prompt 获取失败时，会退回到这个通用 prompt。

## 与主线程 agent 相关的额外规则

- `src/main.tsx:2195`：非交互模式下，如果主线程启用了自定义 agent，可能直接把该 agent 的 prompt 作为 system prompt 使用
- `src/main.tsx:2280`：某些队友/agent 场景下，会把自定义 agent prompt 包装成 `# Custom Agent Instructions` 后追加
- `src/tools/AgentTool/runAgent.ts:906`：运行 agent 时，会先拿 agent 自己的 prompt，再经过 `enhanceSystemPromptWithEnvDetails(...)` 做统一增强

## 内部 side-query / 辅助任务 prompt

这些 prompt 不属于主会话，但会驱动内部模型调用，也属于系统级 prompt surface。

| 名称 | 来源 | 用途 |
| --- | --- | --- |
| `SELECT_MEMORIES_SYSTEM_PROMPT` | `src/memdir/findRelevantMemories.ts:17` | 从 memory 清单里挑选对当前 query 最有帮助的记忆文件 |
| `TOOL_USE_SUMMARY_SYSTEM_PROMPT` | `src/services/toolUseSummary/toolUseSummaryGenerator.ts:14` | 为一批 tool calls 生成一行简短摘要标签 |
| `CRITIQUE_SYSTEM_PROMPT` | `src/cli/handlers/autoMode.ts:48` | 审核 auto mode classifier 规则的清晰度、完整性与冲突 |
| `AGENT_CREATION_SYSTEM_PROMPT` | `src/components/agents/generateAgent.ts:25` | 根据用户描述生成新 agent 的 `identifier / whenToUse / systemPrompt` |
| `SESSION_SEARCH_SYSTEM_PROMPT` | `src/utils/agenticSessionSearch.ts:14` | 从历史 session 中按相关性搜索会话 |
| `SYSTEM_PROMPT` | `src/utils/permissions/permissionExplainer.ts:42` | 解释 shell 命令做什么、为什么运行、潜在风险 |

## 结论

这个仓库没有“唯一的一份固定 system prompt”。更准确地说，它有一组 system-level prompt surface：

- 主会话默认 prompt：`src/constants/prompts.ts:485`
- 主会话最终选择逻辑：`src/utils/systemPrompt.ts:40`
- 模式分支：simple / proactive / coordinator / custom append
- 内建 agent prompt：`src/tools/AgentTool/built-in/*`
- 团队 / agent 运行时 addendum
- 内部 side-query prompt

如果后续要改 prompt 行为，通常先判断你要动的是哪一层：

1. 主会话默认规则
2. 模式分支
3. 某个内建 agent
4. 某个内部 side-query

这几层的入口并不在同一个文件里，最关键的总入口仍然是：

- `src/constants/prompts.ts:485`
- `src/utils/systemPrompt.ts:40`
