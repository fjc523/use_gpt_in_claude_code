# Telegram 通知

本文档说明如何配置 Telegram 通知，以及 `/telegram` 命令当前支持的全部用法。

## 功能概览

Telegram 通知用于在以下场景提醒你：

- 当前 turn 完成，正在等待你的下一步输入
- 需要人工输入 / 批准
- 异常或失败通知

当前实现支持：

- Telegram Bot 配置
- 发送测试消息
- 当前 session 内临时开关
- 跨 session 的全局开关

当前不支持：

- Telegram 端双向交互
- 从 Telegram 端直接回复来驱动 CLI
- 自定义消息模板

---

## 配置方式

你需要准备两项信息：

- `bot token`
- `chat_id`

### 1. 创建 Telegram Bot

在 Telegram 中联系 `@BotFather`，创建一个 bot，并拿到 bot token。

### 2. 获取 chat_id

先给你的 bot 发一条消息，然后访问：

```text
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

在返回结果里找到：

```text
result.message.chat.id
```

这就是你的 `chat_id`。

### 3. 选择一种配置方式

#### 方式 A：使用环境变量

把下面内容加入你的 shell 配置文件：

```bash
export TELEGRAM_BOT_TOKEN=<bot_token>
export TELEGRAM_CHAT_ID=<chat_id>
```

特点：

- 适合本机长期使用
- 适合 CI / 容器环境
- 环境变量优先级高于本地保存配置

#### 方式 B：使用命令直接保存

```text
/telegram save <bot_token> <chat_id>
```

保存后会写入本地配置文件。

### 4. 验证配置

```text
/telegram test
```

如果成功，你会收到一条测试消息。

---

## `/telegram` 命令总览

### `/telegram setup`

显示 Telegram 配置指引。

```text
/telegram setup
```

适合第一次配置时查看步骤。

---

### `/telegram show`

显示当前 Telegram 状态。

```text
/telegram show
```

会显示：

- 是否已配置 credentials
- global toggle 是否开启
- session toggle 是否开启
- 当前是否会实际发送通知
- bot token 掩码
- chat id
- 如果未生效，会给出原因

示例输出可能类似：

```text
Telegram credentials: configured
Global toggle: enabled
Session toggle: enabled
Effective sending: enabled
Bot token: 123456...abcd
Chat ID: 123456789
```

---

### `/telegram save <bot_token> <chat_id>`

保存 Telegram 配置。

```text
/telegram save <bot_token> <chat_id>
```

示例：

```text
/telegram save 123456:ABCDEF 987654321
```

说明：

- 命令会先校验 bot token 是否有效
- 保存成功后，可再执行 `/telegram test`
- 保存的配置用于后续 session

---

### `/telegram clear`

清除本地保存的 Telegram 配置。

```text
/telegram clear
```

注意：

- 这只会清除本地保存的配置
- 如果你仍设置了环境变量：
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  那么 Telegram 仍然会被视为已配置

---

### `/telegram test`

发送测试消息。

```text
/telegram test
```

说明：

- 需要已配置 Telegram
- 同时要求当前没有被 global / session 开关禁用
- 如果当前被禁用，命令会提示原因，而不是继续发送

---

## 开关控制

Telegram 通知现在有两层开关：

- **session 开关**：只影响当前 CLI 进程
- **global 开关**：持久化，影响后续 session

最终是否发送 Telegram 通知，取决于：

- 已配置 credentials
- global 开关已开启
- session 开关已开启

### `/telegram enable`

仅在当前 session 内开启 Telegram 通知。

```text
/telegram enable
```

说明：

- 只影响当前这次 CLI 会话
- 重启 CLI 后不会保留这个操作结果
- 如果 global 已关闭，那么 session enable 也不会强制发送

---

### `/telegram disable`

仅在当前 session 内关闭 Telegram 通知。

```text
/telegram disable
```

说明：

- 只影响当前这次 CLI 会话
- 重启 CLI 后恢复到 global 状态
- 适合临时静音

---

### `/telegram enable-global`

全局开启 Telegram 通知。

```text
/telegram enable-global
```

说明：

- 持久化保存
- 后续新 session 也会保持开启
- 仍然可能被当前 session 的 `/telegram disable` 暂时压住

---

### `/telegram disable-global`

全局关闭 Telegram 通知。

```text
/telegram disable-global
```

说明：

- 持久化保存
- 后续新 session 也会保持关闭
- 即使你使用环境变量配置了 token/chat_id，这个开关仍然有效

---

## 推荐使用方式

### 长期开启 Telegram

1. 配置 credentials：

```text
/telegram save <bot_token> <chat_id>
```

或使用环境变量。

2. 确保全局开启：

```text
/telegram enable-global
```

3. 测试：

```text
/telegram test
```

### 临时静音当前会话

```text
/telegram disable
```

恢复：

```text
/telegram enable
```

### 长期关闭 Telegram

```text
/telegram disable-global
```

如果还想移除凭据：

```text
/telegram clear
```

如果你是通过环境变量配置的，还需要同时删除环境变量。

---

## 优先级与兼容性说明

### 凭据优先级

凭据读取顺序为：

1. 环境变量
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
2. 本地保存配置

也就是说，如果环境变量存在，它们会覆盖本地保存的 token/chat_id。

### 全局开关优先级

全局启用状态按以下顺序决定：

1. 显式 global toggle（`/telegram enable-global` / `/telegram disable-global`）
2. 旧版 `telegram.json` 中的 `enabled` 字段（兼容旧配置）
3. 默认开启

### 最终发送条件

只有当以下条件都满足时，才会真正发送 Telegram 通知：

- credentials 已配置
- global toggle = enabled
- session toggle = enabled

---

## 常见问题

### 1. 我执行了 `/telegram clear`，为什么还是在发消息？

大概率是因为你仍然设置了环境变量：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

环境变量优先级高于本地保存配置。

### 2. 我执行了 `/telegram enable`，为什么还是没有消息？

可能原因：

- global toggle 仍然是 disabled
- credentials 未配置
- `chat_id` 错误
- bot token 无效

先检查：

```text
/telegram show
```

然后再测试：

```text
/telegram test
```

### 3. 我想只在当前会话关闭通知，应该怎么做？

```text
/telegram disable
```

### 4. 我想彻底关闭，跨 session 生效，应该怎么做？

```text
/telegram disable-global
```

### 5. 我想重新打开全局通知，应该怎么做？

```text
/telegram enable-global
```
