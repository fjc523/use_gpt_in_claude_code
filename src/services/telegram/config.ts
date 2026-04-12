import { chmodSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import {
  getSessionTelegramNotificationsEnabled,
} from '../../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'

export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
}

const CONFIG_FILE = 'telegram.json'

function getConfigPath(): string {
  return join(getClaudeConfigHomeDir(), CONFIG_FILE)
}

export function readTelegramConfig(): TelegramConfig | null {
  // Env vars take precedence for credentials
  const envToken = process.env.TELEGRAM_BOT_TOKEN
  const envChat = process.env.TELEGRAM_CHAT_ID
  if (envToken && envChat) {
    return { botToken: envToken, chatId: envChat, enabled: true }
  }

  try {
    const data = readFileSync(getConfigPath(), { encoding: 'utf8' })
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function saveTelegramConfig(config: TelegramConfig): void {
  const dir = getClaudeConfigHomeDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e: unknown) {
    if (getErrnoCode(e) !== 'EEXIST') throw e
  }
  const path = getConfigPath()
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf8' })
  chmodSync(path, 0o600)
}

export function deleteTelegramConfig(): boolean {
  try {
    unlinkSync(getConfigPath())
    return true
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'ENOENT') return true
    return false
  }
}

export function hasTelegramCredentials(): boolean {
  const config = readTelegramConfig()
  return config !== null && !!config.botToken && !!config.chatId
}

export function isTelegramGloballyEnabled(): boolean {
  const globalValue = getGlobalConfig().telegramNotificationsEnabled
  if (globalValue !== undefined) {
    return globalValue
  }

  const config = readTelegramConfig()
  if (config?.enabled !== undefined) {
    return config.enabled
  }

  return true
}

export function setTelegramGloballyEnabled(enabled: boolean): void {
  saveGlobalConfig(current => ({
    ...current,
    telegramNotificationsEnabled: enabled,
  }))
}

export function isTelegramEnabledForSession(): boolean {
  return getSessionTelegramNotificationsEnabled()
}

export function isTelegramConfigured(): boolean {
  return hasTelegramCredentials() && isTelegramGloballyEnabled()
}

export function shouldSendTelegramNotifications(): boolean {
  return (
    hasTelegramCredentials() &&
    isTelegramGloballyEnabled() &&
    isTelegramEnabledForSession()
  )
}
