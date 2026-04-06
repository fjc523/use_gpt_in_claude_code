#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const rootPackageJsonPath = resolve(rootDir, 'package.json')
const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'))

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function parseArgs(argv) {
  const args = {
    tag: null,
    packageJson: null,
    checkMain: false,
    checkRegistry: false,
    output: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--tag') {
      index += 1
      args.tag = argv[index] ?? null
    } else if (token === '--package-json') {
      index += 1
      args.packageJson = argv[index] ?? null
    } else if (token === '--check-main') {
      args.checkMain = true
    } else if (token === '--check-registry') {
      args.checkRegistry = true
    } else if (token === '--output') {
      args.output = true
    } else {
      fail(`Unknown argument: ${token}`)
    }
  }

  if (args.tag === '') {
    fail('--tag requires a value')
  }

  if (args.packageJson === '') {
    fail('--package-json requires a value')
  }

  return args
}

function getReleaseChannel(version) {
  const prerelease = semver.prerelease(version)
  if (!prerelease) {
    return {
      distTag: 'latest',
      isPrerelease: false,
      prereleaseId: null,
    }
  }

  const prereleaseId = String(prerelease[0] ?? '')
  if (prereleaseId !== 'beta' && prereleaseId !== 'rc') {
    fail(
      `Unsupported prerelease identifier "${prereleaseId}" in version ${version}. Only beta and rc are supported.`,
    )
  }

  return {
    distTag: prereleaseId,
    isPrerelease: true,
    prereleaseId,
  }
}

function writeGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`)
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
  const prefix = current && !current.endsWith('\n') ? '\n' : ''
  const next = `${current}${prefix}${lines.join('\n')}\n`
  writeFileSync(outputPath, next)
}

const args = parseArgs(process.argv.slice(2))
const version = rootPackageJson.version

if (!semver.valid(version)) {
  fail(`package.json version is not valid semver: ${version}`)
}

const expectedTag = `v${version}`
const releaseChannel = getReleaseChannel(version)
let publishPackageName = process.env.CLAUDE_CODE_PACKAGE_NAME?.trim() || '@zju_han/claudex-cli'

if (args.tag && args.tag !== expectedTag) {
  fail(`Tag ${args.tag} does not match package.json version ${version}. Expected ${expectedTag}.`)
}

if (args.packageJson) {
  const publishPackageJsonPath = resolve(rootDir, args.packageJson)
  if (!existsSync(publishPackageJsonPath)) {
    fail(`Publish package.json not found: ${publishPackageJsonPath}`)
  }

  const publishPackageJson = JSON.parse(readFileSync(publishPackageJsonPath, 'utf8'))
  publishPackageName = publishPackageJson.name || publishPackageName
  if (publishPackageJson.version !== version) {
    fail(
      `Generated package version ${publishPackageJson.version} does not match root package.json version ${version}.`,
    )
  }
}

if (args.checkMain) {
  const currentCommit = run('git', ['rev-parse', 'HEAD'])
  const mergeBaseCommit = run('git', ['merge-base', 'HEAD', 'origin/main'])
  if (currentCommit !== mergeBaseCommit) {
    fail(
      `Release commit ${currentCommit} is not contained in origin/main. Push tags only from commits already merged into main.`,
    )
  }
}

if (args.checkRegistry) {
  let publishedVersionsJson = ''
  try {
    publishedVersionsJson = run('npm', ['view', publishPackageName, 'versions', '--json'])
  } catch (error) {
    fail(`Unable to query npm registry for ${publishPackageName}. Check npm access and retry from a connected environment.`)
  }

  let publishedVersions = []
  try {
    const parsed = JSON.parse(publishedVersionsJson)
    publishedVersions = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    fail(`Unexpected npm registry response while checking ${publishPackageName} versions.`)
  }

  if (publishedVersions.includes(version)) {
    fail(`npm registry already contains ${publishPackageName}@${version}. Refusing to publish a duplicate release.`)
  }
}

const outputs = {
  version,
  expected_tag: expectedTag,
  dist_tag: releaseChannel.distTag,
  is_prerelease: releaseChannel.isPrerelease,
  publish_package_name: publishPackageName,
}

if (args.output) {
  for (const [key, value] of Object.entries(outputs)) {
    process.stdout.write(`${key}=${String(value)}\n`)
  }
}

writeGitHubOutput(outputs)
