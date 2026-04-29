# claudex

`claudex` 是一个针对gpt优化的 Claude Code fork。

它尽量保留原有终端交互、工具审批和本地执行模型，但默认把模型后端切到 **OpenAI / Codex 兼容的 Responses API**。

`claudex` 与官方 `claude` 默认隔离：`claudex` 的会话、settings、debug、插件缓存等运行态写入 `~/.claudex`，模型和认证读取 `~/.codex`；官方 `claude` 继续使用 `~/.claude` 和 Anthropic API 配置。

## 1. 安装及升级命令

### 安装

```bash
npm install -g @zju_han/claudex-cli
```

从当前仓库本地安装时也只会注册 `claudex` 命令，不会覆盖官方 `claude`：

```bash
npm run build:claudex
npm install -g .
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

注意：`claudex` 不读取全局 `~/.claude/settings.json` 作为自身配置。需要给 `claudex` 单独配置 hooks、MCP、权限或 Telegram 时，请写入 `~/.claudex/settings.json`；如果要改这个位置，可设置 `CLAUDEX_CONFIG_DIR=/path/to/claudex-state`。

ChatGPT 登录态会自动切到 Codex ChatGPT 后端，并在访问令牌过期后尝试用 refresh token 刷新一次。也就是说，已经通过 `codex login` 登录 ChatGPT 的机器通常不需要额外配置 `OPENAI_API_KEY`。

如果希望 ChatGPT 额度耗尽后自动切到 API fallback，可以固定配置：

- `~/.codex/config.fallback.toml`：fallback API provider / model / base_url 配置
- `~/.codex/auth.fallback.json`：fallback API key，格式为 `{"auth_mode":"apikey","CODEX_API_KEY":"..."}` 或 `{"auth_mode":"apikey","OPENAI_API_KEY":"..."}`

运行时默认优先使用 ChatGPT 登录态；当 ChatGPT 返回 quota / usage limit / rate limit / credits exhausted 等错误时，会自动改用 fallback API 配置。fallback 有短期 cooldown，默认 30 分钟，可以用 `CLAUDEX_CHATGPT_FALLBACK_COOLDOWN_MS` 调整。

可以用下面命令检查当前实际生效的认证方式：

```bash
claudex auth status --text
```

在 `claudex` 会话内也可以用 `/status` 查看主备连接。`Current source` 会显示最近一次实际成功使用的源；会话刚启动且尚未发起模型请求时，它显示下一次请求将优先使用的主连接。

### 启动

```bash
claudex
```

与claude唯一的区别就在于启动加一个x，其余所有命令完全一致。

### 核心功能

1. 使用codex配置使用claude code
2. 默认启动了claude code 供内部使用的配置
3. 默认启动为 full access / bypass permissions 模式；如需恢复普通审批模式，可使用 `--permission-mode default` 或在 settings 中配置 `permissions.defaultMode`

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

- `claudex-local` -> `cli-ant.js` -> `dist-ant/cli.js`
- `claude-codex` -> 兼容旧用法，也指向 `cli-ant.js`
- `claudex` -> `cli-ant.js` -> `dist-ant/cli.js`

该脚本不会创建或覆盖 `/opt/homebrew/bin/claude`。

恢复官方链接：

```bash
npm run restore-cli
```
