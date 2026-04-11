import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildTrackedTestCommand,
  classifyTrackedTestPath,
  deriveRustTrackedTestTarget,
  toTrackedStoragePath,
} from './trackedTests'

describe('classifyTrackedTestPath', () => {
  it('classifies MCP test paths before generic TypeScript paths', () => {
    expect(classifyTrackedTestPath('mcp-server/test/tool-registry.test.ts')).toEqual({
      kind: 'mcp',
      relativePath: 'test/tool-registry.test.ts',
    })
  })

  it('classifies frontend TypeScript tests', () => {
    expect(classifyTrackedTestPath('src/packageScripts.test.ts')).toEqual({
      kind: 'frontend',
      path: 'src/packageScripts.test.ts',
    })
  })

  it('classifies Rust tests and includes the derived target', () => {
    expect(classifyTrackedTestPath('src-tauri/src/domains/git/worktrees.rs')).toEqual({
      kind: 'rust',
      path: 'src-tauri/src/domains/git/worktrees.rs',
      target: {
        filter: 'test(/domains::git::worktrees/)',
        kind: 'unit',
      },
    })
  })

  it('rejects unsupported file types', () => {
    expect(() => classifyTrackedTestPath('README.md')).toThrow(
      'Unsupported tracked test path: README.md',
    )
  })
})

describe('deriveRustTrackedTestTarget', () => {
  it('derives a unit test filter from a Rust source file', () => {
    expect(deriveRustTrackedTestTarget('src-tauri/src/domains/git/worktrees.rs')).toEqual({
      filter: 'test(/domains::git::worktrees/)',
      kind: 'unit',
    })
  })

  it('collapses mod.rs to the parent module path', () => {
    expect(deriveRustTrackedTestTarget('src-tauri/src/domains/git/mod.rs')).toEqual({
      filter: 'test(/domains::git/)',
      kind: 'unit',
    })
  })

  it('derives an integration test binary filter', () => {
    expect(deriveRustTrackedTestTarget('src-tauri/tests/session_flow.rs')).toEqual({
      filter: 'binary(session_flow)',
      kind: 'integration',
    })
  })

  it('rejects crate roots because they are too broad', () => {
    expect(() => deriveRustTrackedTestTarget('src-tauri/src/main.rs')).toThrow(
      'Rust crate roots are too broad to track directly: src-tauri/src/main.rs',
    )
    expect(() => deriveRustTrackedTestTarget('src-tauri/src/lib.rs')).toThrow(
      'Rust crate roots are too broad to track directly: src-tauri/src/lib.rs',
    )
  })

  it('rejects Rust paths outside supported roots', () => {
    expect(() => deriveRustTrackedTestTarget('src-tauri/crates/pty_host/src/lib.rs')).toThrow(
      'Unsupported Rust tracked test path: src-tauri/crates/pty_host/src/lib.rs',
    )
  })
})

describe('buildTrackedTestCommand', () => {
  it('runs frontend tracked tests through the existing package script', () => {
    expect(buildTrackedTestCommand('src/utils/trackedTests.test.ts')).toEqual({
      args: ['run', 'test:frontend', '--', 'src/utils/trackedTests.test.ts'],
      command: 'bun',
    })
  })

  it('runs MCP tracked tests from the mcp-server directory', () => {
    expect(buildTrackedTestCommand('mcp-server/test/tool-registry.test.ts')).toEqual({
      args: ['test', '--bail', 'test/tool-registry.test.ts'],
      command: 'bun',
      cwd: 'mcp-server',
    })
  })

  it('runs Rust tracked tests through the cargo worktree wrapper', () => {
    expect(buildTrackedTestCommand('src-tauri/tests/session_flow.rs')).toEqual({
      args: [
        'nextest',
        'run',
        '--cargo-quiet',
        '--status-level',
        'leak',
        '--all-features',
        '-E',
        'binary(session_flow)',
      ],
      command: 'scripts/cargo-worktree.sh',
    })
  })
})

describe('toTrackedStoragePath', () => {
  const repoRoot = '/repo'

  it('normalizes dot-prefixed paths to repo-relative storage paths', () => {
    expect(toTrackedStoragePath(repoRoot, './src/utils/trackedTests.test.ts')).toBe(
      'src/utils/trackedTests.test.ts',
    )
  })

  it('normalizes absolute paths to repo-relative storage paths', () => {
    expect(toTrackedStoragePath(repoRoot, '/repo/src/utils/trackedTests.test.ts')).toBe(
      'src/utils/trackedTests.test.ts',
    )
  })
})

describe('tracked-tests script', () => {
  let tempRoot = ''
  let trackedTestsFile = ''
  let trackedTestsEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tempRoot = mkdtempSync(join(process.cwd(), '.tmp-tracked-tests-'))
    trackedTestsFile = join(tempRoot, '.tracked-tests')
    trackedTestsEnv = {
      ...process.env,
      LUCODE_TRACKED_TESTS_FILE: trackedTestsFile,
    }
  })

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true })
  })

  it('rejects unsupported paths without persisting them', () => {
    const result = spawnSync('bun', ['scripts/tracked-tests.js', 'track', 'README.md'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: trackedTestsEnv,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr.trim()).toBe('Unsupported tracked test path: README.md')
    expect(existsSync(trackedTestsFile)).toBe(false)
  })

  it('clears the configured tracked test file', () => {
    writeFileSync(trackedTestsFile, 'src/utils/trackedTests.test.ts\n')

    const result = spawnSync('bun', ['scripts/tracked-tests.js', 'clear'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: trackedTestsEnv,
    })

    expect(result.status).toBe(0)
    expect(existsSync(trackedTestsFile)).toBe(false)
  })
})
