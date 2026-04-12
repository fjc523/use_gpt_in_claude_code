import {
  getSessionTelegramNotificationsEnabled,
  setSessionTelegramNotificationsEnabled,
} from '../../bootstrap/state.js'
import type { LocalCommandCall } from '../../types/command.js'
import {
  deleteTelegramConfig,
  hasTelegramCredentials,
  isTelegramEnabledForSession,
  isTelegramGloballyEnabled,
  readTelegramConfig,
  saveTelegramConfig,
  setTelegramGloballyEnabled,
  shouldSendTelegramNotifications,
} from '../../services/telegram/config.js'
import {
  sendTelegramMessage,
  validateTelegramBot,
} from '../../services/telegram/sender.js'

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'show'

  switch (sub) {
    case 'setup':
      return setup()
    case 'show':
      return show()
    case 'save':
      return save(parts[1], parts[2])
    case 'clear':
      return clear()
    case 'enable':
      return enableSession()
    case 'disable':
      return disableSession()
    case 'enable-global':
      return enableGlobal()
    case 'disable-global':
      return disableGlobal()
    case 'test':
      return test()
    default:
      return {
        type: 'text',
        value:
          `Unknown subcommand: ${sub}\n` +
          'Usage: /telegram setup | show | save <token> <chat_id> | clear | enable | disable | enable-global | disable-global | test',
      }
  }
}

async function setup(): Promise<{ type: 'text'; value: string }> {
  return {
    type: 'text',
    value: [
      'To set up Telegram notifications:',
      '',
      '1. Create a bot via @BotFather on Telegram and copy the bot token',
      '2. Send a message to your bot, then visit:',
      '   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates',
      '   to find your chat_id (in result.message.chat.id)',
      '3. Set environment variables (add to your shell profile):',
      '',
      '   export TELEGRAM_BOT_TOKEN=<bot_token>',
      '   export TELEGRAM_CHAT_ID=<chat_id>',
      '',
      'Or save config directly:',
      '   /telegram save <bot_token> <chat_id>',
      '',
      'Optional toggles:',
      '   /telegram disable          # disable in this session only',
      '   /telegram disable-global   # disable across sessions',
      '',
      'Then verify with: /telegram test',
    ].join('\n'),
  }
}

function show(): { type: 'text'; value: string } {
  const config = readTelegramConfig()
  const hasCredentials = hasTelegramCredentials()
  const globalEnabled = isTelegramGloballyEnabled()
  const sessionEnabled = isTelegramEnabledForSession()
  const effectiveEnabled = shouldSendTelegramNotifications()

  if (!config) {
    return {
      type: 'text',
      value: [
        'Telegram not configured. Run /telegram setup for instructions.',
        `Global toggle: ${globalEnabled ? 'enabled' : 'disabled'}`,
        `Session toggle: ${sessionEnabled ? 'enabled' : 'disabled'}`,
        `Effective sending: ${effectiveEnabled ? 'enabled' : 'disabled'}`,
      ].join('\n'),
    }
  }

  const masked = config.botToken
    ? config.botToken.slice(0, 6) + '...' + config.botToken.slice(-4)
    : '(empty)'

  const reasons: string[] = []
  if (!hasCredentials) reasons.push('missing credentials')
  if (!globalEnabled) reasons.push('disabled globally')
  if (!sessionEnabled) reasons.push('disabled in this session')

  return {
    type: 'text',
    value: [
      `Telegram credentials: ${hasCredentials ? 'configured' : 'missing'}`,
      `Global toggle: ${globalEnabled ? 'enabled' : 'disabled'}`,
      `Session toggle: ${sessionEnabled ? 'enabled' : 'disabled'}`,
      `Effective sending: ${effectiveEnabled ? 'enabled' : 'disabled'}`,
      `Bot token: ${masked}`,
      `Chat ID: ${config.chatId || '(empty)'}`,
      ...(reasons.length > 0 ? [`Reason: ${reasons.join(', ')}`] : []),
    ].join('\n'),
  }
}

function clear(): { type: 'text'; value: string } {
  const ok = deleteTelegramConfig()
  return {
    type: 'text',
    value: ok
      ? 'Telegram configuration cleared.'
      : 'Failed to clear Telegram configuration.',
  }
}

function enableSession(): { type: 'text'; value: string } {
  setSessionTelegramNotificationsEnabled(true)
  return {
    type: 'text',
    value: `Telegram notifications enabled for this session. Global toggle is currently ${isTelegramGloballyEnabled() ? 'enabled' : 'disabled'}.`,
  }
}

function disableSession(): { type: 'text'; value: string } {
  setSessionTelegramNotificationsEnabled(false)
  return {
    type: 'text',
    value: 'Telegram notifications disabled for this session.',
  }
}

function enableGlobal(): { type: 'text'; value: string } {
  setTelegramGloballyEnabled(true)
  return {
    type: 'text',
    value: `Telegram notifications enabled globally. Session toggle is currently ${getSessionTelegramNotificationsEnabled() ? 'enabled' : 'disabled'}.`,
  }
}

function disableGlobal(): { type: 'text'; value: string } {
  setTelegramGloballyEnabled(false)
  return {
    type: 'text',
    value: 'Telegram notifications disabled globally.',
  }
}

async function save(
  botToken: string | undefined,
  chatId: string | undefined,
): Promise<{ type: 'text'; value: string }> {
  if (!botToken || !chatId) {
    return {
      type: 'text',
      value: 'Usage: /telegram save <bot_token> <chat_id>',
    }
  }

  const validation = await validateTelegramBot(botToken)
  if (!validation.ok) {
    return {
      type: 'text',
      value: 'Bot token validation failed. Check your token and try again.',
    }
  }

  saveTelegramConfig({ botToken, chatId, enabled: true })
  return {
    type: 'text',
    value: `Telegram configured for @${validation.username || 'unknown'}. Run /telegram test to verify.`,
  }
}

async function test(): Promise<{ type: 'text'; value: string }> {
  const config = readTelegramConfig()
  if (!config || !config.botToken || !config.chatId) {
    return {
      type: 'text',
      value: 'Telegram not configured. Run /telegram setup first.',
    }
  }

  if (!shouldSendTelegramNotifications()) {
    return {
      type: 'text',
      value: 'Telegram is configured, but sending is currently disabled by the global or session toggle.',
    }
  }

  const validation = await validateTelegramBot(config.botToken)
  if (!validation.ok) {
    return {
      type: 'text',
      value: 'Bot token validation failed. Check your token.',
    }
  }

  const sent = await sendTelegramMessage(
    `✅ Claude Code test notification\nBot: @${validation.username || 'unknown'}`,
  )
  return {
    type: 'text',
    value: sent
      ? `Test message sent via @${validation.username || 'unknown'}.`
      : 'Failed to send test message. Check your chat_id.',
  }
}
