import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  getOpenAIFallbackAuthConfigs,
  getMissingOpenAIApiKeyMessage,
  getOpenAIAuthConfig,
  loadCodexProviderConfig,
  refreshOpenAIChatGPTAuthToken,
  resolveOpenAIBaseUrl,
  resolveOpenAIModel,
  resolveOpenAIProviderHeaders,
  resolveOpenAIProviderQueryParams,
  shouldUseOpenAIOfficialClientHeaders,
  type OpenAIAuthConfig,
} from './openaiCodexConfig.js'
import {
  buildOpenAICodexTurnMetadata,
  getOpenAICodexIdentity,
  resolveOpenAICodexSessionId,
  shouldAttachOpenAICodexTurnMetadata,
} from './openaiCodexIdentity.js'
import type { OpenAIErrorPayload } from './openaiResponsesTypes.js'

function parseRetryAfterMs(
  headers: Headers,
): number | null {
  const retryAfterMs = headers.get('retry-after-ms')
  if (retryAfterMs) {
    const parsed = Number.parseInt(retryAfterMs, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }

  const retryAfter = headers.get('retry-after')
  if (!retryAfter) {
    return null
  }

  const seconds = Number.parseFloat(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }

  const retryAt = Date.parse(retryAfter)
  if (Number.isNaN(retryAt)) {
    return null
  }

  return Math.max(0, retryAt - Date.now())
}

function extractOpenAIRequestId(headers: Headers): string | undefined {
  return (
    headers.get('x-request-id') ??
    headers.get('request-id') ??
    headers.get('openai-request-id') ??
    undefined
  )
}

function shouldFallbackFromChatGPT(
  authConfig: OpenAIAuthConfig,
  status: number,
  payloadText: string,
): boolean {
  if (authConfig.mode !== 'chatgpt') {
    return false
  }

  if (status === 429) {
    return true
  }

  const normalized = payloadText.toLowerCase()
  return (
    status === 401 ||
    status === 403 ||
    normalized.includes('usage limit') ||
    normalized.includes('quota') ||
    normalized.includes('credit limit') ||
    normalized.includes('out of credits') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('upgrade to plus') ||
    normalized.includes('upgrade to pro') ||
    normalized.includes('plan and billing')
  )
}

function shouldFallbackFromOpenAIError(
  authConfig: OpenAIAuthConfig,
  status: number,
  payloadText: string,
): boolean {
  if (shouldFallbackFromChatGPT(authConfig, status, payloadText)) {
    return true
  }

  const normalized = payloadText.toLowerCase()
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    normalized.includes('usage limit') ||
    normalized.includes('quota') ||
    normalized.includes('credit limit') ||
    normalized.includes('out of credits') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests')
  )
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.name === 'AbortError'
  )
}

function applyFallbackModel(body: unknown, authConfig: OpenAIAuthConfig): unknown {
  const fallbackModel = authConfig.providerConfig?.model
  if (!authConfig.isFallback || !fallbackModel) {
    return body
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'model')) {
    return body
  }
  return {
    ...(body as Record<string, unknown>),
    model: fallbackModel,
  }
}

export class OpenAIHTTPError extends Error {
  readonly status: number
  readonly bodyText: string
  readonly headers: Headers
  readonly requestId: string | undefined
  readonly retryAfterMs: number | null

  constructor({
    status,
    bodyText,
    headers,
  }: {
    status: number
    bodyText: string
    headers: Headers
  }) {
    super(normalizeOpenAIErrorMessage(bodyText, status))
    this.name = 'OpenAIHTTPError'
    this.status = status
    this.bodyText = bodyText
    this.headers = headers
    this.requestId = extractOpenAIRequestId(headers)
    this.retryAfterMs = parseRetryAfterMs(headers)
  }
}

const DEFAULT_CHATGPT_FALLBACK_COOLDOWN_MS = 30 * 60 * 1000
const FALLBACK_COOLDOWN_ENV = 'CLAUDEX_CHATGPT_FALLBACK_COOLDOWN_MS'

let chatGPTFallbackUntilMs = 0

export type OpenAIConnectionSnapshot = {
  role: 'primary' | 'fallback'
  name: string
  providerId: string
  baseUrl: string
  model: string
  credentialSource: string
  authMode: OpenAIAuthConfig['mode']
  lastUsedAt?: string
}

let lastSuccessfulOpenAIAuthConfig: OpenAIAuthConfig | undefined
let lastSuccessfulOpenAIAuthUsedAt: string | undefined

function getChatGPTFallbackCooldownMs(): number {
  const parsed = Number.parseInt(process.env[FALLBACK_COOLDOWN_ENV] ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_CHATGPT_FALLBACK_COOLDOWN_MS
}

function getFallbackAuthConfigsExcluding(
  currentAuth: OpenAIAuthConfig,
): OpenAIAuthConfig[] {
  return getOpenAIFallbackAuthConfigs().filter(
    auth =>
      auth.source !== currentAuth.source ||
      auth.bearerToken !== currentAuth.bearerToken,
  )
}

function getProviderIdForAuth(authConfig: OpenAIAuthConfig): string {
  return authConfig.providerConfig?.providerId ?? loadCodexProviderConfig().providerId
}

function getModelForAuth(authConfig: OpenAIAuthConfig): string {
  return authConfig.providerConfig?.model ?? resolveOpenAIModel(undefined)
}

function getConnectionNameForAuth(authConfig: OpenAIAuthConfig): string {
  if (authConfig.isFallback) {
    return authConfig.connectionName ?? getProviderIdForAuth(authConfig)
  }
  return getProviderIdForAuth(authConfig)
}

function buildOpenAIConnectionSnapshot(
  authConfig: OpenAIAuthConfig,
  lastUsedAt?: string,
): OpenAIConnectionSnapshot {
  return {
    role: authConfig.isFallback ? 'fallback' : 'primary',
    name: getConnectionNameForAuth(authConfig),
    providerId: getProviderIdForAuth(authConfig),
    baseUrl: resolveOpenAIBaseUrl(authConfig),
    model: getModelForAuth(authConfig),
    credentialSource: authConfig.source,
    authMode: authConfig.mode,
    lastUsedAt,
  }
}

function markOpenAIConnectionUsed(authConfig: OpenAIAuthConfig): void {
  lastSuccessfulOpenAIAuthConfig = authConfig
  lastSuccessfulOpenAIAuthUsedAt = new Date().toISOString()
}

export function getOpenAIActiveConnectionSnapshot():
  | OpenAIConnectionSnapshot
  | undefined {
  if (lastSuccessfulOpenAIAuthConfig) {
    return buildOpenAIConnectionSnapshot(
      lastSuccessfulOpenAIAuthConfig,
      lastSuccessfulOpenAIAuthUsedAt,
    )
  }

  const authConfig = getOpenAIAuthConfig()
  if (!authConfig) {
    return undefined
  }

  if (authConfig.mode === 'chatgpt' && Date.now() < chatGPTFallbackUntilMs) {
    const fallbackAuth = getOpenAIFallbackAuthConfigs()[0]
    if (fallbackAuth) {
      return buildOpenAIConnectionSnapshot(fallbackAuth)
    }
  }

  return buildOpenAIConnectionSnapshot(authConfig)
}

function appendProviderQueryParams(url: URL, authConfig?: OpenAIAuthConfig): URL {
  const queryParams = resolveOpenAIProviderQueryParams(authConfig)
  if (!queryParams) {
    return url
  }

  for (const [key, value] of Object.entries(queryParams)) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
  }

  return url
}

function resolveOpenAIRequestUrl(
  pathOrUrl: string,
  authConfig?: OpenAIAuthConfig,
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }

  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  const url = new URL(`${resolveOpenAIBaseUrl(authConfig)}${path}`)
  return appendProviderQueryParams(url, authConfig).toString()
}

export function normalizeOpenAIErrorMessage(
  payloadText: string,
  status: number,
): string {
  try {
    const parsed = JSON.parse(payloadText) as OpenAIErrorPayload
    if (parsed.error?.message) {
      return parsed.error.message
    }
  } catch {
    // Fall back to the raw payload text.
  }

  return payloadText || `OpenAI request failed with status ${status}`
}

export function buildOpenAIHeaders(
  apiKey: string,
  extraHeaders: HeadersInit | undefined,
  body: unknown,
  authConfig?: OpenAIAuthConfig,
): Headers {
  const providerHeaders = resolveOpenAIProviderHeaders(authConfig)
  const headers = new Headers(providerHeaders)

  if (extraHeaders) {
    for (const [key, value] of new Headers(extraHeaders).entries()) {
      headers.set(key, value)
    }
  }

  headers.set('authorization', `Bearer ${apiKey}`)
  if (authConfig?.mode === 'chatgpt' && authConfig.accountId) {
    headers.set('chatgpt-account-id', authConfig.accountId)
  }
  if (body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return headers
}

export async function buildOpenAIRequestHeaders(
  apiKey: string,
  extraHeaders: HeadersInit | undefined,
  body: unknown,
  authConfig: OpenAIAuthConfig | undefined = getOpenAIAuthConfig(),
): Promise<Headers> {
  const headers = buildOpenAIHeaders(apiKey, extraHeaders, body, authConfig)

  if (!shouldUseOpenAIOfficialClientHeaders(authConfig)) {
    return headers
  }

  const identity = await getOpenAICodexIdentity(getIsNonInteractiveSession())
  if (!headers.has('user-agent')) {
    headers.set('user-agent', identity.userAgent)
  }
  if (!headers.has('originator')) {
    headers.set('originator', identity.originator)
  }

  const sessionId = resolveOpenAICodexSessionId(body)
  if (sessionId) {
    if (!headers.has('session_id')) {
      headers.set('session_id', sessionId)
    }
    if (!headers.has('x-client-request-id')) {
      headers.set('x-client-request-id', sessionId)
    }
  }

  if (shouldAttachOpenAICodexTurnMetadata(body) && !headers.has('x-codex-turn-metadata')) {
    const metadata = await buildOpenAICodexTurnMetadata(body)
    if (metadata) {
      headers.set('x-codex-turn-metadata', metadata)
    }
  }

  return headers
}

export async function fetchOpenAIResponse(
  pathOrUrl: string,
  options: {
    method?: string
    body?: unknown
    headers?: HeadersInit
    signal?: AbortSignal
  } = {},
): Promise<Response> {
  let authConfig = getOpenAIAuthConfig()
  if (
    authConfig?.mode === 'chatgpt' &&
    Date.now() < chatGPTFallbackUntilMs
  ) {
    authConfig = getOpenAIFallbackAuthConfigs()[0] ?? authConfig
  }
  if (!authConfig) {
    throw new Error(getMissingOpenAIApiKeyMessage())
  }

  const { method = 'GET', body, headers, signal } = options
  const requestBodyForAuth = (auth: OpenAIAuthConfig) => {
    if (body === undefined) {
      return undefined
    }
    if (typeof body === 'string') {
      return body
    }
    return jsonStringify(applyFallbackModel(body, auth))
  }
  const requestBodyMetadataForAuth = (auth: OpenAIAuthConfig) =>
    typeof body === 'string' ? body : applyFallbackModel(body, auth)
  const send = async (auth: OpenAIAuthConfig) =>
    fetch(resolveOpenAIRequestUrl(pathOrUrl, auth), {
      method,
      headers: await buildOpenAIRequestHeaders(
        auth.bearerToken,
        headers,
        requestBodyMetadataForAuth(auth),
        auth,
      ),
      body: requestBodyForAuth(auth),
      signal,
    })

  const tryFallbacks = async (
    failedAuthConfig: OpenAIAuthConfig,
    failedHeaders?: Headers,
  ): Promise<Response | undefined> => {
    const fallbackAuthConfigs = getFallbackAuthConfigsExcluding(failedAuthConfig)
    if (fallbackAuthConfigs.length === 0) {
      return undefined
    }

    if (failedAuthConfig.mode === 'chatgpt') {
      chatGPTFallbackUntilMs =
        Date.now() +
        Math.max(
          failedHeaders
            ? (parseRetryAfterMs(failedHeaders) ?? 0)
            : 0,
          getChatGPTFallbackCooldownMs(),
        )
    }

    let lastHttpError:
      | {
          status: number
          bodyText: string
          headers: Headers
        }
      | undefined
    let lastNetworkError: unknown

    for (const fallbackAuth of fallbackAuthConfigs) {
      let fallbackResponse: Response
      try {
        fallbackResponse = await send(fallbackAuth)
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }
        lastNetworkError = error
        continue
      }

      if (fallbackResponse.ok) {
        markOpenAIConnectionUsed(fallbackAuth)
        return fallbackResponse
      }

      const fallbackPayloadText = await fallbackResponse.text()
      lastHttpError = {
        status: fallbackResponse.status,
        bodyText: fallbackPayloadText,
        headers: new Headers(fallbackResponse.headers),
      }
      if (
        !shouldFallbackFromOpenAIError(
          fallbackAuth,
          fallbackResponse.status,
          fallbackPayloadText,
        )
      ) {
        break
      }
    }

    if (lastHttpError) {
      throw new OpenAIHTTPError(lastHttpError)
    }
    if (lastNetworkError) {
      throw lastNetworkError
    }
    return undefined
  }

  let response: Response
  try {
    response = await send(authConfig)
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    const fallbackResponse = await tryFallbacks(authConfig)
    if (fallbackResponse) {
      return fallbackResponse
    }
    throw error
  }
  if (response.status === 401 && authConfig.mode === 'chatgpt') {
    const refreshedAuth = await refreshOpenAIChatGPTAuthToken()
    if (refreshedAuth) {
      response = await send(refreshedAuth)
      authConfig = refreshedAuth
    }
  }

  if (!response.ok) {
    const payloadText = await response.text()
    if (shouldFallbackFromOpenAIError(authConfig, response.status, payloadText)) {
      const fallbackResponse = await tryFallbacks(
        authConfig,
        new Headers(response.headers),
      )
      if (fallbackResponse) {
        return fallbackResponse
      }
    }
    throw new OpenAIHTTPError({
      status: response.status,
      bodyText: payloadText,
      headers: new Headers(response.headers),
    })
  }

  markOpenAIConnectionUsed(authConfig)
  return response
}

export async function fetchOpenAIJson<T>(
  pathOrUrl: string,
  options: {
    method?: string
    body?: unknown
    headers?: HeadersInit
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const response = await fetchOpenAIResponse(pathOrUrl, options)
  const payloadText = await response.text()

  if (!payloadText) {
    throw new Error('OpenAI request returned an empty payload')
  }

  return JSON.parse(payloadText) as T
}
