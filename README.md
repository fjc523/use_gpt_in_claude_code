# claudex

`claudex` 是一个针对gpt优化的 Claude Code fork。

它尽量保留原有终端交互、工具审批和本地执行模型，但默认把模型后端切到 **OpenAI / Codex 兼容的 Responses API**。

## 1. 安装及升级命令

### 安装

```bash
npm install -g @zju_han/claudex-cli
```

### 升级

```bash
npm upgrade -g @zju_han/claudex-cli
```

### 环境

确保 Codex 可以正常调用模型。`claudex` 会自动读取 Codex 的模型配置和认证信息启动 GPT / Codex 模型。

当前支持两种 OpenAI / Codex 认证方式，并按优先级自动选择：

1. 环境变量 API key：优先读取 `OPENAI_API_KEY`；如果 `~/.codex/config.toml` 的 provider 配置了 `env_key`，则先读该环境变量，再 fallback 到 `OPENAI_API_KEY`。
2. Codex 本地认证文件：读取 `~/.codex/auth.json`。`auth_mode = "apikey"` 时使用文件内 API key；`auth_mode = "chatgpt"` 时复用 `codex login` 的 ChatGPT 登录态。

ChatGPT 登录态会自动切到 Codex ChatGPT 后端，并在访问令牌过期后尝试用 refresh token 刷新一次。也就是说，已经通过 `codex login` 登录 ChatGPT 的机器通常不需要额外配置 `OPENAI_API_KEY`。

可以用下面命令检查当前实际生效的认证方式：

```bash
claudex auth status --text
```

### 启动

```bash
claudex
```

与claude唯一的区别就在于启动加一个x，其余所有命令完全一致。

### 核心功能

1. 使用codex配置使用claude code
2. 默认启动了claude code 供内部使用的配置

## 2. opus 模式（默认）

opus 模式让 gpt 输出更接近 opus 风格：更深分析、更强结构、更高主动性。

现在它已经是默认模式，开箱即用。核心行为：

- 非 trivial 任务先给短计划再动手
- 偏好最小可 review 的 diff
- 常规可逆步骤默认继续，不频繁确认
- 收尾默认给出：what changed / assumptions or risks / checks run
- 输出简洁、结论先行、短句优先

```bash
claudex --opus
```

或者在 session 内：

```text
/opus
```

如果你想临时回到更简洁的旧风格，可以在当前 session 里执行一次 `/opus` 关闭它。

## 3. Telegram 通知功能

如果你想在任务完成、需要人工输入或出现失败时收到 Telegram 通知，需要准备：

- `bot token`
- `chat_id`

### 方式 A：环境变量

```bash
export TELEGRAM_BOT_TOKEN=<bot_token>
export TELEGRAM_CHAT_ID=<chat_id>
```

### 方式 B：命令保存

```text
/telegram save <bot_token> <chat_id>
```

### 测试通知

```text
/telegram test
```

### 常用开关

```text
/telegram enable
/telegram disable
/telegram enable-global
/telegram disable-global
```

详细说明见：`docs/telegram.md`

## 更多文档

- `docs/INDEX.md` — 文档总入口
- `docs/telegram.md` — Telegram 通知完整说明
- `docs/implementation/hybrid-native-implementation-plan.md` — 当前实现工作的 source of truth
- `docs/release-version-policy.md` — 发版与版本规则

## 4. 本地 launcher 辅助脚本

```bash
npm run activate-cli
```

激活后命令对应关系为：

- `claudex-local` -> 当前默认构建（`cli.js` -> `dist/cli.js`，版本显示 `2.1.88`）
- `claude-codex` -> 当前默认构建（`cli.js` -> `dist/cli.js`，版本显示 `2.1.88`）
- `claudex` -> ant 变体构建（`cli-ant.js` -> `dist-ant/cli.js`，版本显示当前仓库版本）

恢复官方链接：

```bash
npm run restore-cli
```
