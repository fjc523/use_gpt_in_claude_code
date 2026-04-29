import { homedir } from 'os'
import { join } from 'path'

type MutableEnv = NodeJS.ProcessEnv

const CLAUDEX_FLAVOR = 'claudex'
const OPENAI_RESPONSES_BACKEND = 'openaiResponses'

export function getDefaultClaudexConfigDir(home = homedir()): string {
  return join(home, '.claudex')
}

export function isClaudexFlavor(flavor: string | undefined): boolean {
  return flavor?.trim().toLowerCase() === CLAUDEX_FLAVOR
}

/**
 * ClaudeX must not read or write the official Claude Code config tree. It still
 * reads Codex/OpenAI credentials from ~/.codex via openaiCodexConfig.ts.
 */
export function applyClaudexRuntimeIsolation(
  flavor = process.env.CLAUDE_CODE_CLI_FLAVOR,
  env: MutableEnv = process.env,
  home = homedir(),
): void {
  if (!isClaudexFlavor(flavor)) {
    return
  }

  env.CLAUDEX_CLI = '1'
  env.CLAUDE_CONFIG_DIR =
    env.CLAUDEX_CONFIG_DIR || getDefaultClaudexConfigDir(home)
  env.CUBENCE_MODEL_BACKEND = OPENAI_RESPONSES_BACKEND
  env.CLAUDE_CODE_MODEL_BACKEND = OPENAI_RESPONSES_BACKEND
}
