import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('bun:bundle', () => ({
  feature: () => false,
}))

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

describe('getAssistantMessageFromError', () => {
  it('[P0:model] maps bare terminated errors to a recoverable interruption message', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const { getAssistantMessageFromError } = await import(
      '../../../src/services/api/errors.js'
    )

    const message = getAssistantMessageFromError(new Error('terminated'), 'gpt-5.4')

    expect(message.type).toBe('assistant')
    expect(message.isApiErrorMessage).toBe(true)
    expect(message.error).toBe('unknown')
    expect(message.errorDetails).toBe('terminated')
    expect(message.message.content).toEqual([
      { type: 'text', text: 'stream ended before completion' },
    ])
  }, 20000)
})
