import { describe, expect, it } from 'vitest'
import {
  applyClaudexRuntimeIsolation,
  getDefaultClaudexConfigDir,
} from '../../../src/entrypoints/claudexIsolation.js'

describe('claudex runtime isolation', () => {
  it('[P0:runtime] leaves normal Claude entrypoints untouched', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
      CLAUDE_CODE_MODEL_BACKEND: 'claude',
    }

    applyClaudexRuntimeIsolation(undefined, env, '/home/me')

    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
      CLAUDE_CODE_MODEL_BACKEND: 'claude',
    })
  })

  it('[P0:runtime] forces ClaudeX state to ~/.claudex and Codex backend', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
      CLAUDE_CODE_MODEL_BACKEND: 'claude',
      CUBENCE_MODEL_BACKEND: 'claude',
    }

    applyClaudexRuntimeIsolation('claudex', env, '/home/me')

    expect(env.CLAUDEX_CLI).toBe('1')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claudex')
    expect(env.CLAUDE_CODE_MODEL_BACKEND).toBe('openaiResponses')
    expect(env.CUBENCE_MODEL_BACKEND).toBe('openaiResponses')
  })

  it('[P0:runtime] supports an explicit ClaudeX-only config dir override', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDEX_CONFIG_DIR: '/tmp/claudex-state',
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
    }

    applyClaudexRuntimeIsolation('claudex', env, '/home/me')

    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/claudex-state')
  })

  it('[P0:runtime] documents the default ClaudeX config directory', () => {
    expect(getDefaultClaudexConfigDir('/home/me')).toBe('/home/me/.claudex')
  })
})
