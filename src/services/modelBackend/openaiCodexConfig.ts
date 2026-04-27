import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { normalizeOpenAICompatibleModel } from './openaiModelCatalog.js'

type StringMap = Record<string, string>

export type CodexProviderConfig = {
  providerId: string
  model: string
  disableResponseStorage: boolean
  baseUrl: string
  baseUrlExplicit: boolean
  wireApi: string
  envKey: string
  requiresOpenAIAuth: boolean
  promptCacheRetention?: 'in_memory' | '24h'
  modelContextWindow?: number
  reasoningEffort?: OpenAIReasoningEffort
  httpHeaders?: StringMap
  envHttpHeaders?: StringMap
  queryParams?: StringMap
  experimentalBearerToken?: string
}

type CodexAuthMode = 'apikey' | 'chatgpt' | 'chatgptAuthTokens'

type CodexAuthConfig = {
  authMode?: CodexAuthMode
  openaiApiKey?: string
  chatgptAccessToken?: string
  chatgptRefreshToken?: string
  chatgptAccountId?: string
  lastRefresh?: string
}

export type OpenAIAuthMode = 'api_key' | 'chatgpt'

export type OpenAIAuthConfig = {
  mode: OpenAIAuthMode
  bearerToken: string
  source: string
  accountId?: string
  refreshable: boolean
  providerConfig?: CodexProviderConfig
  isFallback?: boolean
  connectionName?: string
}

export type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

let cachedProviderConfig: CodexProviderConfig | null | undefined
let cachedAuthConfig: CodexAuthConfig | null | undefined

type FallbackConnectionDefinition = {
  name: string
  configFilename: string
  authFilename: string
}

type FallbackProviderConfigEntry = FallbackConnectionDefinition & {
  providerConfig: CodexProviderConfig
}

let cachedFallbackProviderConfigEntries:
  | FallbackProviderConfigEntry[]
  | undefined
let cachedFallbackAuthConfigs:
  | Record<string, CodexAuthConfig | null>
  | undefined

const DEFAULT_MODEL = 'gpt-5.5'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const DEFAULT_ENV_KEY = 'OPENAI_API_KEY'
const FALLBACK_CONFIG_FILENAME = 'config.fallback.toml'
const FALLBACK_AUTH_FILENAME = 'auth.fallback.json'
const FALLBACK_CONNECTIONS: FallbackConnectionDefinition[] = [
  {
    name: 'openai',
    configFilename: 'config.toml.openai',
    authFilename: 'auth.json.openai',
  },
  {
    name: 'claudexai',
    configFilename: 'config.toml.claudexai',
    authFilename: 'auth.json.claudexai',
  },
  {
    name: 'fallback',
    configFilename: FALLBACK_CONFIG_FILENAME,
    authFilename: FALLBACK_AUTH_FILENAME,
  },
]
const CHATGPT_REFRESH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CHATGPT_REFRESH_TOKEN_URL_ENV = 'CODEX_REFRESH_TOKEN_URL_OVERRIDE'
const CODEX_CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

function getCodexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}

function getCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json')
}

function getCodexFallbackConfigPath(filename: string): string {
  return join(homedir(), '.codex', filename)
}

function getCodexFallbackAuthPath(filename: string): string {
  return join(homedir(), '.codex', filename)
}

function getCodexFallbackDisplayPath(filename: string): string {
  return `~/.codex/${filename}`
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function writeCodexAuthJson(value: Record<string, unknown>): void {
  const path = getCodexAuthPath()
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort; writeFileSync mode covers newly-created files.
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function getRecordString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? trimToUndefined(value) : undefined
}

function getAuthJsonTokens(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const tokens = parsed.tokens
  return tokens && typeof tokens === 'object' && !Array.isArray(tokens)
    ? (tokens as Record<string, unknown>)
    : {}
}

function matchString(source: string, pattern: RegExp): string | undefined {
  return trimToUndefined(source.match(pattern)?.[1])
}

function matchBoolean(source: string, pattern: RegExp): boolean | undefined {
  const value = source.match(pattern)?.[1]
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function matchInteger(source: string, pattern: RegExp): number | undefined {
  const value = source.match(pattern)?.[1]
  if (!value) return undefined
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizePromptCacheRetention(
  value: string | undefined,
): 'in_memory' | '24h' | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === '24h') return '24h'
  if (normalized === 'in_memory' || normalized === 'in-memory') {
    return 'in_memory'
  }
  return undefined
}

function normalizeReasoningEffort(
  value: string | undefined,
): OpenAIReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return normalized
    case 'max':
      return 'xhigh'
    default:
      return undefined
  }
}

function normalizeAuthMode(value: string | undefined): CodexAuthMode | undefined {
  switch (value?.trim()) {
    case 'apikey':
      return 'apikey'
    case 'chatgpt':
      return 'chatgpt'
    case 'chatgptAuthTokens':
      return 'chatgptAuthTokens'
    default:
      return undefined
  }
}

function getTableSection(source: string, tablePath: string): string {
  const escaped = escapeRegex(tablePath)
  const pattern = new RegExp(
    `\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`,
  )
  return source.match(pattern)?.[1] ?? ''
}

function getActiveProfileSection(source: string): string {
  const profileName = matchString(source, /^profile\s*=\s*"([^"]+)"/m)
  if (!profileName) {
    return ''
  }
  return getTableSection(source, `profiles.${profileName}`)
}

function matchInlineTableBody(source: string, key: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*${escapeRegex(key)}\\s*=\\s*\\{([^\\n]*)\\}\\s*$`,
    'm',
  )
  return source.match(pattern)?.[1]
}

function parseInlineStringMap(value: string | undefined): StringMap | undefined {
  if (!value) {
    return undefined
  }

  const entries: StringMap = {}
  const pattern = /(?:"([^"]+)"|([A-Za-z0-9_.-]+))\s*=\s*"([^"]*)"/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const key = match[1] ?? match[2]
    const entryValue = match[3]
    if (!key) {
      continue
    }
    entries[key] = entryValue
  }

  return Object.keys(entries).length > 0 ? entries : undefined
}

function mergeStringMaps(
  ...maps: Array<StringMap | undefined>
): StringMap | undefined {
  const merged: StringMap = {}

  for (const map of maps) {
    if (!map) continue
    for (const [key, value] of Object.entries(map)) {
      const trimmed = trimToUndefined(value)
      if (trimmed) {
        merged[key] = trimmed
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/responses')) {
    return trimmed.slice(0, -'/responses'.length)
  }
  return trimmed
}

function normalizeEnvKey(envKey: string | undefined): string {
  const trimmed = envKey?.trim()
  return trimmed || DEFAULT_ENV_KEY
}

function getConfiguredApiKeyEnvNames(): string[] {
  return getApiKeyEnvNamesForProvider(loadCodexProviderConfig())
}

function getApiKeyEnvNamesForProvider(providerConfig: CodexProviderConfig): string[] {
  const configured = normalizeEnvKey(providerConfig.envKey)
  return configured === DEFAULT_ENV_KEY
    ? [DEFAULT_ENV_KEY]
    : [configured, DEFAULT_ENV_KEY]
}

function getConfiguredAuthJsonKeyNames(): string[] {
  return getConfiguredApiKeyEnvNames()
}

function getAuthJsonKeyNamesForProvider(providerConfig: CodexProviderConfig): string[] {
  return getApiKeyEnvNamesForProvider(providerConfig)
}

function getEffectiveProviderId(raw: string, profileSection: string): string {
  return (
    matchString(profileSection, /^\s*model_provider\s*=\s*"([^"]+)"/m) ||
    matchString(raw, /^model_provider\s*=\s*"([^"]+)"/m) ||
    'openai'
  )
}

function getEffectiveModel(raw: string, profileSection: string): string {
  return (
    matchString(profileSection, /^\s*model\s*=\s*"([^"]+)"/m) ||
    matchString(raw, /^model\s*=\s*"([^"]+)"/m) ||
    DEFAULT_MODEL
  )
}

function getDefaultProviderConfig(): CodexProviderConfig {
  return {
    providerId: 'openai',
    model: DEFAULT_MODEL,
    disableResponseStorage: true,
    baseUrl: DEFAULT_BASE_URL,
    baseUrlExplicit: false,
    wireApi: 'responses',
    envKey: DEFAULT_ENV_KEY,
    requiresOpenAIAuth: false,
    promptCacheRetention: undefined,
    modelContextWindow: undefined,
    reasoningEffort: undefined,
    httpHeaders: undefined,
    envHttpHeaders: undefined,
    queryParams: undefined,
    experimentalBearerToken: undefined,
  }
}

function parseCodexProviderConfig(raw: string): CodexProviderConfig {
  const profileSection = getActiveProfileSection(raw)
  const providerId = getEffectiveProviderId(raw, profileSection)
  const providerSection = getTableSection(raw, `model_providers.${providerId}`)
  const topLevelModel = getEffectiveModel(raw, profileSection)
  const disableResponseStorage =
    matchBoolean(
      profileSection,
      /^\s*disable_response_storage\s*=\s*(true|false)/m,
    ) ??
    matchBoolean(raw, /^disable_response_storage\s*=\s*(true|false)/m) ??
    true

  const openaiBaseUrl =
    providerId === 'openai'
      ? matchString(profileSection, /^\s*openai_base_url\s*=\s*"([^"]+)"/m) ||
        matchString(raw, /^openai_base_url\s*=\s*"([^"]+)"/m)
      : undefined

  const providerBaseUrl = matchString(
    providerSection,
    /^\s*base_url\s*=\s*"([^"]+)"/m,
  )
  const baseUrl = providerBaseUrl || openaiBaseUrl || DEFAULT_BASE_URL
  const baseUrlExplicit = Boolean(providerBaseUrl || openaiBaseUrl)
  const wireApi =
    matchString(providerSection, /^\s*wire_api\s*=\s*"([^"]+)"/m) ||
    'responses'
  const requiresOpenAIAuth =
    matchBoolean(
      providerSection,
      /^\s*requires_openai_auth\s*=\s*(true|false)/m,
    ) ?? false
  const promptCacheRetention = normalizePromptCacheRetention(
    matchString(profileSection, /^\s*prompt_cache_retention\s*=\s*"([^"]+)"/m) ||
      matchString(raw, /^prompt_cache_retention\s*=\s*"([^"]+)"/m) ||
      matchString(
        providerSection,
        /^\s*prompt_cache_retention\s*=\s*"([^"]+)"/m,
      ),
  )
  const modelContextWindow =
    matchInteger(profileSection, /^\s*model_context_window\s*=\s*(\d+)/m) ||
    matchInteger(raw, /^model_context_window\s*=\s*(\d+)/m) ||
    matchInteger(providerSection, /^\s*model_context_window\s*=\s*(\d+)/m)
  const reasoningEffort = normalizeReasoningEffort(
    matchString(profileSection, /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m) ||
      matchString(raw, /^model_reasoning_effort\s*=\s*"([^"]+)"/m) ||
      matchString(
        providerSection,
        /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m,
      ),
  )
  const envKey = normalizeEnvKey(
    matchString(providerSection, /^\s*env_key\s*=\s*"([^"]+)"/m),
  )
  const httpHeaders = parseInlineStringMap(
    matchInlineTableBody(providerSection, 'http_headers'),
  )
  const envHttpHeaders = parseInlineStringMap(
    matchInlineTableBody(providerSection, 'env_http_headers'),
  )
  const queryParams = parseInlineStringMap(
    matchInlineTableBody(providerSection, 'query_params'),
  )
  const experimentalBearerToken = matchString(
    providerSection,
    /^\s*experimental_bearer_token\s*=\s*"([^"]+)"/m,
  )

  return {
    providerId,
    model: normalizeOpenAICompatibleModel(topLevelModel) ?? topLevelModel,
    disableResponseStorage,
    baseUrl: normalizeBaseUrl(baseUrl),
    baseUrlExplicit,
    wireApi,
    requiresOpenAIAuth,
    promptCacheRetention,
    modelContextWindow,
    reasoningEffort,
    envKey,
    httpHeaders,
    envHttpHeaders,
    queryParams,
    experimentalBearerToken,
  }
}

export function loadCodexProviderConfig(): CodexProviderConfig {
  if (cachedProviderConfig) return cachedProviderConfig
  if (cachedProviderConfig === null) {
    return getDefaultProviderConfig()
  }

  const raw = readIfExists(getCodexConfigPath())
  if (!raw) {
    cachedProviderConfig = null
    return loadCodexProviderConfig()
  }

  cachedProviderConfig = parseCodexProviderConfig(raw)
  return cachedProviderConfig
}

export function loadOpenAIFallbackProviderConfig(): CodexProviderConfig | undefined {
  return loadOpenAIFallbackProviderConfigEntries()[0]?.providerConfig
}

function loadOpenAIFallbackProviderConfigEntries(): FallbackProviderConfigEntry[] {
  if (cachedFallbackProviderConfigEntries) {
    return cachedFallbackProviderConfigEntries
  }

  cachedFallbackProviderConfigEntries = FALLBACK_CONNECTIONS.flatMap(
    connection => {
      const raw = readIfExists(
        getCodexFallbackConfigPath(connection.configFilename),
      )
      if (!raw) {
        return []
      }
      return [
        {
          ...connection,
          providerConfig: parseCodexProviderConfig(raw),
        },
      ]
    },
  )
  return cachedFallbackProviderConfigEntries
}

export function isOpenAIResponsesBackendEnabled(): boolean {
  const configured =
    process.env.CUBENCE_MODEL_BACKEND ??
    process.env.CLAUDE_CODE_MODEL_BACKEND ??
    'openaiResponses'
  return configured.toLowerCase() !== 'claude'
}

function parseCodexAuthConfig(
  raw: string,
  authJsonKeyNames: string[],
): CodexAuthConfig {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const authMode = normalizeAuthMode(
      typeof parsed.auth_mode === 'string' ? parsed.auth_mode : undefined,
    )
    const isChatGPTAuth =
      authMode === 'chatgpt' || authMode === 'chatgptAuthTokens'
    const tokens = getAuthJsonTokens(parsed)
    const openaiApiKey = isChatGPTAuth
      ? undefined
      : authJsonKeyNames
          .map(key => getRecordString(parsed, key))
          .find(value => Boolean(value))
    return {
      authMode,
      openaiApiKey,
      chatgptAccessToken: isChatGPTAuth
        ? getRecordString(tokens, 'access_token')
        : undefined,
      chatgptRefreshToken: isChatGPTAuth
        ? getRecordString(tokens, 'refresh_token')
        : undefined,
      chatgptAccountId: isChatGPTAuth
        ? getRecordString(tokens, 'account_id')
        : undefined,
      lastRefresh: getRecordString(parsed, 'last_refresh'),
    }
  } catch {
    return {}
  }
}

export function loadCodexAuthConfig(): CodexAuthConfig {
  if (cachedAuthConfig) return cachedAuthConfig
  if (cachedAuthConfig === null) return {}

  const raw = readIfExists(getCodexAuthPath())
  if (!raw) {
    cachedAuthConfig = null
    return {}
  }

  cachedAuthConfig = parseCodexAuthConfig(raw, getConfiguredAuthJsonKeyNames())
  return cachedAuthConfig
}

function loadOpenAIFallbackAuthConfigForEntry(
  entry: FallbackProviderConfigEntry,
): CodexAuthConfig {
  cachedFallbackAuthConfigs ??= {}
  const cached = cachedFallbackAuthConfigs[entry.name]
  if (cached) return cached
  if (cached === null) return {}

  const raw = readIfExists(getCodexFallbackAuthPath(entry.authFilename))
  if (!raw) {
    cachedFallbackAuthConfigs[entry.name] = null
    return {}
  }

  const parsed = parseCodexAuthConfig(
    raw,
    getAuthJsonKeyNamesForProvider(entry.providerConfig),
  )
  cachedFallbackAuthConfigs[entry.name] = parsed
  return parsed
}

export function loadOpenAIFallbackAuthConfig(): CodexAuthConfig {
  const firstEntry = loadOpenAIFallbackProviderConfigEntries()[0]
  return firstEntry ? loadOpenAIFallbackAuthConfigForEntry(firstEntry) : {}
}

export function getOpenAIAuthConfig(): OpenAIAuthConfig | undefined {
  const providerConfig = loadCodexProviderConfig()
  const auth = loadCodexAuthConfig()
  if (auth.chatgptAccessToken) {
    return {
      mode: 'chatgpt',
      bearerToken: auth.chatgptAccessToken,
      source: '~/.codex/auth.json',
      accountId: auth.chatgptAccountId,
      refreshable: Boolean(auth.chatgptRefreshToken),
    }
  }

  for (const envName of getApiKeyEnvNamesForProvider(providerConfig)) {
    const envKey = process.env[envName]?.trim()
    if (envKey) {
      return {
        mode: 'api_key',
        bearerToken: envKey,
        source: envName,
        refreshable: false,
      }
    }
  }

  if (providerConfig.experimentalBearerToken?.trim()) {
    return {
      mode: 'api_key',
      bearerToken: providerConfig.experimentalBearerToken.trim(),
      source: 'experimental_bearer_token',
      refreshable: false,
    }
  }

  if (auth.openaiApiKey) {
    return {
      mode: 'api_key',
      bearerToken: auth.openaiApiKey,
      source: '~/.codex/auth.json',
      refreshable: false,
    }
  }

  return undefined
}

export function getOpenAIFallbackAuthConfig(): OpenAIAuthConfig | undefined {
  return getOpenAIFallbackAuthConfigs()[0]
}

function getOpenAIFallbackAuthConfigForEntry(
  entry: FallbackProviderConfigEntry,
): OpenAIAuthConfig | undefined {
  const auth = loadOpenAIFallbackAuthConfigForEntry(entry)
  if (auth.chatgptAccessToken) {
    return {
      mode: 'chatgpt',
      bearerToken: auth.chatgptAccessToken,
      source: getCodexFallbackDisplayPath(entry.authFilename),
      accountId: auth.chatgptAccountId,
      refreshable: Boolean(auth.chatgptRefreshToken),
      providerConfig: entry.providerConfig,
      isFallback: true,
      connectionName: entry.name,
    }
  }

  if (auth.openaiApiKey) {
    return {
      mode: 'api_key',
      bearerToken: auth.openaiApiKey,
      source: getCodexFallbackDisplayPath(entry.authFilename),
      refreshable: false,
      providerConfig: entry.providerConfig,
      isFallback: true,
      connectionName: entry.name,
    }
  }

  if (entry.providerConfig.experimentalBearerToken?.trim()) {
    return {
      mode: 'api_key',
      bearerToken: entry.providerConfig.experimentalBearerToken.trim(),
      source: getCodexFallbackDisplayPath(entry.configFilename),
      refreshable: false,
      providerConfig: entry.providerConfig,
      isFallback: true,
      connectionName: entry.name,
    }
  }

  return undefined
}

export function getOpenAIFallbackAuthConfigs(): OpenAIAuthConfig[] {
  return loadOpenAIFallbackProviderConfigEntries().flatMap(entry => {
    const authConfig = getOpenAIFallbackAuthConfigForEntry(entry)
    return authConfig ? [authConfig] : []
  })
}

export function getOpenAIApiKey(): string | undefined {
  return getOpenAIAuthConfig()?.bearerToken
}

export function resolveOpenAIAuthMode(): OpenAIAuthMode | undefined {
  return getOpenAIAuthConfig()?.mode
}

export function resolveOpenAIApiKeyEnvKey(): string {
  return loadCodexProviderConfig().envKey
}

export function describeOpenAIApiKeySources(): string {
  const envNames = getConfiguredApiKeyEnvNames()
  return [...envNames, '~/.codex/auth.json'].join(' or ')
}

export function getMissingOpenAIApiKeyMessage(): string {
  return `No OpenAI/Codex API key is configured. Expected ${describeOpenAIApiKeySources()}.`
}

function getProviderConfigForAuth(
  authConfig?: OpenAIAuthConfig,
): CodexProviderConfig {
  return authConfig?.providerConfig ?? loadCodexProviderConfig()
}

export function resolveOpenAIBaseUrl(authConfig?: OpenAIAuthConfig): string {
  const provider = getProviderConfigForAuth(authConfig)
  const envBaseUrl = process.env.OPENAI_BASE_URL
  if (
    !envBaseUrl &&
    !provider.baseUrlExplicit &&
    (authConfig?.mode ?? resolveOpenAIAuthMode()) === 'chatgpt'
  ) {
    return DEFAULT_CHATGPT_BASE_URL
  }
  return normalizeBaseUrl(envBaseUrl || provider.baseUrl)
}

export async function refreshOpenAIChatGPTAuthToken(): Promise<
  OpenAIAuthConfig | undefined
> {
  const auth = loadCodexAuthConfig()
  if (!auth.chatgptRefreshToken) {
    return undefined
  }

  const response = await fetch(
    process.env[CHATGPT_REFRESH_TOKEN_URL_ENV] || CHATGPT_REFRESH_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CHATGPT_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: auth.chatgptRefreshToken,
      }),
    },
  )

  const payloadText = await response.text()
  if (!response.ok) {
    throw new Error(
      payloadText ||
        `ChatGPT auth token refresh failed with status ${response.status}`,
    )
  }

  let payload: {
    id_token?: string
    access_token?: string
    refresh_token?: string
  }
  try {
    payload = JSON.parse(payloadText) as typeof payload
  } catch {
    throw new Error('ChatGPT auth token refresh returned invalid JSON')
  }

  const accessToken = payload.access_token?.trim()
  if (!accessToken) {
    throw new Error('ChatGPT auth token refresh did not return access_token')
  }

  const raw = readIfExists(getCodexAuthPath())
  const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  const existingTokens = getAuthJsonTokens(parsed)
  parsed.auth_mode =
    normalizeAuthMode(
      typeof parsed.auth_mode === 'string' ? parsed.auth_mode : undefined,
    ) ?? 'chatgpt'
  parsed.tokens = {
    ...existingTokens,
    id_token: payload.id_token?.trim() || existingTokens.id_token,
    access_token: accessToken,
    refresh_token: payload.refresh_token?.trim() || auth.chatgptRefreshToken,
    account_id: auth.chatgptAccountId || existingTokens.account_id,
  }
  parsed.last_refresh = new Date().toISOString()
  writeCodexAuthJson(parsed)
  cachedAuthConfig = undefined
  return getOpenAIAuthConfig()
}

export function resolveOpenAIProviderHeaders(
  authConfig?: OpenAIAuthConfig,
): StringMap | undefined {
  const config = getProviderConfigForAuth(authConfig)
  const envHeaders = Object.fromEntries(
    Object.entries(config.envHttpHeaders ?? {}).flatMap(([headerName, envName]) => {
      const value = process.env[envName]?.trim()
      return value ? [[headerName, value]] : []
    }),
  )

  return mergeStringMaps(config.httpHeaders, envHeaders)
}

export function resolveOpenAIProviderQueryParams(
  authConfig?: OpenAIAuthConfig,
): StringMap | undefined {
  return getProviderConfigForAuth(authConfig).queryParams
}

export function shouldUseOpenAIOfficialClientHeaders(
  authConfig?: OpenAIAuthConfig,
): boolean {
  return getProviderConfigForAuth(authConfig).requiresOpenAIAuth
}

export function resolveOpenAIModel(currentModel: string | undefined): string {
  const candidate = normalizeOpenAICompatibleModel(currentModel)
  if (candidate) {
    return candidate
  }
  return (
    normalizeOpenAICompatibleModel(process.env.OPENAI_MODEL) ||
    normalizeOpenAICompatibleModel(loadCodexProviderConfig().model) ||
    DEFAULT_MODEL
  )
}

export function shouldStoreOpenAIResponses(): boolean {
  if (process.env.CUBENCE_DISABLE_RESPONSE_STORAGE === '1') {
    return false
  }
  return !loadCodexProviderConfig().disableResponseStorage
}

export function resolveOpenAIConfiguredContextWindow(
  currentModel?: string,
): number | undefined {
  const envWindow = matchInteger(
    process.env.OPENAI_MODEL_CONTEXT_WINDOW || '',
    /^(\d+)$/,
  )
  if (envWindow) {
    return envWindow
  }

  const config = loadCodexProviderConfig()
  if (!config.modelContextWindow) {
    return undefined
  }
  if (!currentModel) {
    return config.modelContextWindow
  }

  const configuredModel = resolveOpenAIModel(config.model)
  const normalizedCurrentModel = resolveOpenAIModel(currentModel)
  return normalizedCurrentModel === configuredModel
    ? config.modelContextWindow
    : undefined
}

export function resolveOpenAIPromptCacheRetention():
  | 'in_memory'
  | '24h'
  | undefined {
  return normalizePromptCacheRetention(
    process.env.OPENAI_PROMPT_CACHE_RETENTION ||
      loadCodexProviderConfig().promptCacheRetention,
  )
}

export function resolveOpenAIReasoningEffort():
  | OpenAIReasoningEffort
  | undefined {
  return normalizeReasoningEffort(
    process.env.OPENAI_REASONING_EFFORT ||
      loadCodexProviderConfig().reasoningEffort,
  )
}
