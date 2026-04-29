#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'

process.env.CLAUDEX_CLI = '1'
process.env.CLAUDE_CODE_CLI_FLAVOR = 'claudex'
process.env.CLAUDE_CONFIG_DIR =
  process.env.CLAUDEX_CONFIG_DIR || join(homedir(), '.claudex')
process.env.CUBENCE_MODEL_BACKEND = 'openaiResponses'
process.env.CLAUDE_CODE_MODEL_BACKEND = 'openaiResponses'

await import('./dist-ant/cli.js')
