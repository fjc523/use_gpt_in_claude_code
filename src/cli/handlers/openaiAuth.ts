/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import { BRAND_NAME } from '../../constants/brand.js'
import {
  describeOpenAIApiKeySources,
  getOpenAIFallbackAuthConfig,
  getOpenAIFallbackAuthConfigs,
  getOpenAIAuthConfig,
  getOpenAIApiKey,
  getMissingOpenAIApiKeyMessage,
  loadCodexProviderConfig,
  resolveOpenAIBaseUrl,
  resolveOpenAIModel,
  shouldStoreOpenAIResponses,
} from '../../services/modelBackend/openaiCodexConfig.js'
import { buildOpenAIRequestHeaders } from '../../services/modelBackend/openaiApi.js'
import { errorMessage } from '../../utils/errors.js'
import { renderModelName } from '../../utils/model/model.js'
import { jsonStringify } from '../../utils/slowOperations.js'

type ApiKeySource = string | 'none'

function getApiKeySource(): ApiKeySource {
  return getOpenAIAuthConfig()?.source ?? 'none'
}

async function validateConfiguredKey(): Promise<{
  ok: boolean
  error?: string
}> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return {
      ok: false,
      error: getMissingOpenAIApiKeyMessage(),
    }
  }

  try {
    const requestBody = {
      model: resolveOpenAIModel(undefined),
      // Some OpenAI-compatible proxies reject validation pings unless
      // `instructions` is present, even when the regular prompt body is valid.
      instructions: 'You are a helpful assistant.',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Reply with exactly ok' }],
        },
      ],
      stream: true,
      store: false,
    }
    const response = await fetch(`${resolveOpenAIBaseUrl()}/responses`, {
      method: 'POST',
      headers: await buildOpenAIRequestHeaders(
        apiKey,
        {
          accept: 'application/json',
        },
        requestBody,
      ),
      body: jsonStringify(requestBody),
    })

    if (response.ok) {
      return { ok: true }
    }

    const text = await response.text()
    let message = text
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      message = parsed.error?.message || text
    } catch {
      // Fall back to raw text
    }

    return {
      ok: false,
      error: message || `Responses request failed with status ${response.status}`,
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

function getStatusPayload() {
  const provider = loadCodexProviderConfig()
  const apiKeySource = getApiKeySource()
  const fallbackAuth = getOpenAIFallbackAuthConfig()
  const fallbackAuths = getOpenAIFallbackAuthConfigs()

  return {
    loggedIn: apiKeySource !== 'none',
    authMethod:
      apiKeySource === 'none'
        ? 'none'
        : (getOpenAIAuthConfig()?.mode ?? 'api_key'),
    apiProvider: 'openaiResponses',
    providerId: provider.providerId,
    baseUrl: resolveOpenAIBaseUrl(),
    model: resolveOpenAIModel(undefined),
    wireApi: provider.wireApi,
    storeResponses: shouldStoreOpenAIResponses(),
    apiKeySource: apiKeySource === 'none' ? null : apiKeySource,
    fallbackApiKeySource: fallbackAuth?.source ?? null,
    fallbackBaseUrl: fallbackAuth ? resolveOpenAIBaseUrl(fallbackAuth) : null,
    fallbackModel: fallbackAuth?.providerConfig?.model ?? null,
    fallbacks: fallbackAuths.map(auth => ({
      name: auth.connectionName ?? 'fallback',
      apiKeySource: auth.source,
      baseUrl: resolveOpenAIBaseUrl(auth),
      model: auth.providerConfig?.model ?? null,
    })),
  }
}

export async function authLogin(): Promise<void> {
  const status = getStatusPayload()
  if (!status.loggedIn) {
    process.stderr.write(
      `${BRAND_NAME} uses OpenAI/Codex-style file or environment credentials.\n` +
        `Set ${describeOpenAIApiKeySources()}, then retry.\n`,
    )
    process.exit(1)
  }

  const validation = await validateConfiguredKey()
  if (!validation.ok) {
    process.stderr.write(
      `Configured OpenAI/Codex credentials failed validation: ${validation.error}\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `${BRAND_NAME} is ready to use the configured OpenAI/Codex credentials.\n`,
  )
  process.exit(0)
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  const status = getStatusPayload()

  if (opts.text) {
    const modelLabel = renderModelName(status.model)
    process.stdout.write(`Backend: OpenAI/Codex Responses\n`)
    process.stdout.write(`Provider: ${status.providerId}\n`)
    process.stdout.write(
      `Model: ${modelLabel === status.model ? status.model : `${modelLabel} (${status.model})`}\n`,
    )
    process.stdout.write(`Base URL: ${status.baseUrl}\n`)
    process.stdout.write(`Wire API: ${status.wireApi}\n`)
    process.stdout.write(`Store responses: ${status.storeResponses}\n`)
    process.stdout.write(
      `Credentials: ${status.apiKeySource ?? 'not configured'}\n`,
    )
    process.stdout.write(
      `Fallback credentials: ${status.fallbackApiKeySource ?? 'not configured'}\n`,
    )
    for (const [index, fallback] of status.fallbacks.entries()) {
      process.stdout.write(
        `Fallback ${index + 1}: ${fallback.name} (${fallback.apiKeySource}, ${fallback.baseUrl}, ${fallback.model ?? 'configured model'})\n`,
      )
    }
    if (status.fallbackBaseUrl) {
      process.stdout.write(`Fallback Base URL: ${status.fallbackBaseUrl}\n`)
    }
    if (status.fallbackModel) {
      process.stdout.write(`Fallback Model: ${status.fallbackModel}\n`)
    }
    if (!status.loggedIn) {
      process.stdout.write(
        `Not configured. Set ${describeOpenAIApiKeySources()}.\n`,
      )
    }
  } else {
    process.stdout.write(jsonStringify(status, null, 2) + '\n')
  }

  process.exit(status.loggedIn ? 0 : 1)
}

export async function authLogout(): Promise<void> {
  process.stdout.write(
    `${BRAND_NAME} does not manage OpenAI/Codex credentials directly.\n` +
      `Remove ${describeOpenAIApiKeySources()} if you want to disable this backend.\n`,
  )
  process.exit(0)
}
