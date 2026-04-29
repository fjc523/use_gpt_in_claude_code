import { spawnSync } from 'node:child_process'
import {
  cpSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const outputDirName = process.env.CLAUDE_CODE_BUILD_OUTDIR || 'dist'
const outputUserType = process.env.CLAUDE_CODE_BUILD_USER_TYPE?.trim() || null
const promptVariant = process.env.CLAUDE_CODE_PROMPT_VARIANT?.trim() || null
const cliFlavor = process.env.CLAUDE_CODE_CLI_FLAVOR?.trim() || null
const distDir = join(rootDir, outputDirName)
const outFile = join(distDir, 'cli.js')
const vendorDir = join(rootDir, 'vendor')
const distVendorDir = join(distDir, 'vendor')
const strayOutFile = join(rootDir, 'src', 'entrypoints', 'cli.js')
const strayMapFile = join(rootDir, 'src', 'entrypoints', 'cli.js.map')

const packageVersion =
  process.env.CLAUDE_CODE_PACKAGE_VERSION?.trim() || packageJson.version
const packageUrl = process.env.CLAUDE_CODE_PACKAGE_NAME?.trim() || packageJson.name
const nativePackageUrl =
  process.env.CLAUDE_CODE_NATIVE_PACKAGE_NAME?.trim() || packageUrl
const feedbackChannel =
  process.env.CLAUDE_CODE_FEEDBACK_CHANNEL?.trim() ||
  packageJson.bugs?.url ||
  packageJson.homepage ||
  ''
const versionChangelog = process.env.CLAUDE_CODE_VERSION_CHANGELOG?.trim() || ''

const defines = {
  'MACRO.VERSION': packageVersion,
  'MACRO.BUILD_TIME': new Date().toISOString(),
  'MACRO.PACKAGE_URL': packageUrl,
  'MACRO.NATIVE_PACKAGE_URL': nativePackageUrl,
  'MACRO.FEEDBACK_CHANNEL': feedbackChannel,
  'MACRO.ISSUES_EXPLAINER': 'open an issue',
  'MACRO.VERSION_CHANGELOG': versionChangelog,
  ...(outputUserType ? { 'process.env.USER_TYPE': outputUserType } : {}),
  ...(promptVariant
    ? { 'process.env.CLAUDE_CODE_PROMPT_VARIANT': promptVariant }
    : {}),
  ...(cliFlavor ? { 'process.env.CLAUDE_CODE_CLI_FLAVOR': cliFlavor } : {}),
}

const externals = [
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/mcpb',
  '@anthropic-ai/sandbox-runtime',
  '@anthropic-ai/sandbox-runtime/*',
  'modifiers-napi',
]

rmSync(distDir, { force: true, recursive: true })
mkdirSync(distDir, { recursive: true })
rmSync(strayOutFile, { force: true })
rmSync(strayMapFile, { force: true })

const args = [
  'build',
  'src/entrypoints/cli.tsx',
  '--target=node',
  '--format=esm',
  '--sourcemap=linked',
  '--outdir',
  distDir,
  '--root',
  join(rootDir, 'src', 'entrypoints'),
  '--entry-naming',
  '[name].[ext]',
]

for (const [key, value] of Object.entries(defines)) {
  args.push('--define', `${key}=${JSON.stringify(value)}`)
}

for (const external of externals) {
  args.push('--external', external)
}

const result = spawnSync('bun', args, {
  cwd: rootDir,
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const built = readFileSync(outFile, 'utf8')
const shebang = '#!/usr/bin/env node\n'
writeFileSync(outFile, built.startsWith(shebang) ? built : `${shebang}${built}`)
chmodSync(outFile, 0o755)

cpSync(vendorDir, distVendorDir, { recursive: true })

for (const ripgrepBinary of [
  join(distVendorDir, 'ripgrep', 'x64-darwin', 'rg'),
  join(distVendorDir, 'ripgrep', 'arm64-darwin', 'rg'),
  join(distVendorDir, 'ripgrep', 'x64-linux', 'rg'),
  join(distVendorDir, 'ripgrep', 'arm64-linux', 'rg'),
]) {
  try {
    chmodSync(ripgrepBinary, 0o755)
  } catch {
    // Ignore missing platform binaries
  }
}
