import { beforeEach, describe, expect, it, vi } from 'vitest'

const chmodMock = vi.hoisted(() => vi.fn())
const statMock = vi.hoisted(() => vi.fn())
const execFileNoThrowMock = vi.hoisted(() => vi.fn())
const findExecutableMock = vi.hoisted(() => vi.fn())
const logErrorMock = vi.hoisted(() => vi.fn())
const logForDebuggingMock = vi.hoisted(() => vi.fn())
const logEventMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/services/analytics/index.js', () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}))
vi.mock('../../../src/utils/bundledMode.js', () => ({
  isInBundledMode: () => false,
}))
vi.mock('../../../src/utils/debug.js', () => ({
  logForDebugging: (...args: unknown[]) => logForDebuggingMock(...args),
}))
vi.mock('../../../src/utils/envUtils.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/utils/envUtils.js')>()
  return {
    ...actual,
    isEnvDefinedFalsy: actual.isEnvDefinedFalsy,
  }
})
vi.mock('../../../src/utils/execFileNoThrow.js', () => ({
  execFileNoThrow: (...args: unknown[]) => execFileNoThrowMock(...args),
}))
vi.mock('../../../src/utils/findExecutable.js', () => ({
  findExecutable: (...args: unknown[]) => findExecutableMock(...args),
}))
vi.mock('../../../src/utils/log.js', () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}))
vi.mock('../../../src/utils/platform.js', () => ({
  getPlatform: () => 'darwin',
}))
vi.mock('fs/promises', () => ({
  chmod: (...args: unknown[]) => chmodMock(...args),
  stat: (...args: unknown[]) => statMock(...args),
}))
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, callback: Function) => {
    callback(null, 'match.txt\n', '')
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    }
  }),
  spawn: vi.fn(),
}))

const ORIGINAL_ENV = { ...process.env }

describe('ripgrep execute-bit self-heal', () => {
  beforeEach(async () => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV, USE_BUILTIN_RIPGREP: '1' }
    chmodMock.mockReset()
    statMock.mockReset()
    execFileNoThrowMock.mockReset()
    findExecutableMock.mockReset()
    logErrorMock.mockReset()
    logForDebuggingMock.mockReset()
    logEventMock.mockReset()

    chmodMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue({ mode: 0o100644 })
    execFileNoThrowMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: '',
    })
    findExecutableMock.mockReturnValue({ cmd: 'rg' })

    const ripgrep = await import('../../../src/utils/ripgrep.ts')
    ripgrep.__resetRipgrepTestState()
  })

  it('[P0:model] repairs builtin vendored ripgrep when execute bits are missing before the first search', async () => {
    const ripgrep = await import('../../../src/utils/ripgrep.ts')

    const results = await ripgrep.ripGrep(
      ['--files'],
      '/tmp/project',
      new AbortController().signal,
    )

    expect(chmodMock).toHaveBeenCalledWith(expect.stringContaining('/vendor/ripgrep/'), 0o755)
    expect(results).toEqual(['match.txt'])
  })

  it('[P0:model] skips chmod when builtin vendored ripgrep is already executable', async () => {
    statMock.mockResolvedValueOnce({ mode: 0o100755 })

    const ripgrep = await import('../../../src/utils/ripgrep.ts')
    ripgrep.__resetRipgrepTestState()

    await ripgrep.ripGrep(
      ['--files'],
      '/tmp/project',
      new AbortController().signal,
    )

    expect(chmodMock).not.toHaveBeenCalled()
  })

  it('[P0:model] logs repair failures and leaves the later execution path to surface the real error', async () => {
    const chmodError = new Error('permission denied')
    chmodMock.mockRejectedValueOnce(chmodError)

    const ripgrep = await import('../../../src/utils/ripgrep.ts')
    ripgrep.__resetRipgrepTestState()

    await ripgrep.ripGrep(
      ['--files'],
      '/tmp/project',
      new AbortController().signal,
    )

    expect(logErrorMock).toHaveBeenCalledWith(chmodError)
  })
})
