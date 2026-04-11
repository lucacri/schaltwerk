#!/usr/bin/env bun

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { buildTrackedTestCommand, classifyTrackedTestPath, toTrackedStoragePath } from '../src/utils/trackedTests.ts'

const TRACKED_TESTS_FILE = resolve(process.cwd(), process.env.LUCODE_TRACKED_TESTS_FILE ?? '.tracked-tests')
const FRONTEND_ENV = {
  ...process.env,
  FORCE_COLOR: '0',
  NODE_NO_WARNINGS: '1',
  ROLLUP_SKIP_NODEJS_NATIVE_ADDON: '1',
}
const RUST_ENV = {
  ...process.env,
  CARGO_TERM_COLOR: 'never',
  CARGO_TERM_PROGRESS_WHEN: 'never',
  RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -Awarnings`.trim(),
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: options.captureOutput ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })

  if (options.captureOutput) {
    return {
      ...result,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    }
  }

  return result
}

function normalizeStoredPath(inputPath) {
  const trimmedPath = inputPath.trim()

  if (trimmedPath.length === 0) {
    fail('Tracked test path cannot be empty')
  }

  return trimmedPath
}

function resolveTrackedPath(inputPath) {
  const normalizedInput = normalizeStoredPath(inputPath)
  const absolutePath = resolve(process.cwd(), normalizedInput)

  if (!existsSync(absolutePath)) {
    fail(`Tracked test path does not exist: ${normalizedInput}`)
  }

  const relativePath = relative(process.cwd(), absolutePath).replaceAll('\\', '/')

  if (relativePath.startsWith('..')) {
    fail(`Tracked test path must stay inside the repo: ${normalizedInput}`)
  }

  return {
    absolutePath,
    relativePath,
    storedPath: toTrackedStoragePath(process.cwd(), normalizedInput),
  }
}

function readTrackedPaths() {
  if (!existsSync(TRACKED_TESTS_FILE)) {
    return []
  }

  return readFileSync(TRACKED_TESTS_FILE, 'utf8')
    .split('\n')
    .map((path) => path.trim())
    .filter((path, index, allPaths) => path.length > 0 && allPaths.indexOf(path) === index)
}

function writeTrackedPaths(paths) {
  if (paths.length === 0) {
    rmSync(TRACKED_TESTS_FILE, { force: true })
    return
  }

  writeFileSync(TRACKED_TESTS_FILE, `${paths.join('\n')}\n`)
}

function trackPath(inputPath) {
  const { relativePath, storedPath } = resolveTrackedPath(inputPath)
  try {
    classifyTrackedTestPath(relativePath)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  const trackedPaths = readTrackedPaths()

  if (!trackedPaths.includes(storedPath)) {
    trackedPaths.push(storedPath)
    writeTrackedPaths(trackedPaths)
  }

  return storedPath
}

function untrackPath(inputPath) {
  const storedPath = toTrackedStoragePath(process.cwd(), normalizeStoredPath(inputPath))
  writeTrackedPaths(readTrackedPaths().filter((path) => path !== storedPath))
}

function clearTrackedPaths() {
  writeTrackedPaths([])
}

function ensureRustMatches(filter) {
  const result = runCommand(
    'scripts/cargo-worktree.sh',
    ['nextest', 'list', '--cargo-quiet', '--all-features', '--message-format', 'json', '-E', filter],
    { captureOutput: true, env: RUST_ENV },
  )

  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  const output = result.stdout.trim()

  if (output.length === 0) {
    fail(`No Rust tests matched filter: ${filter}`)
  }

  const parsed = JSON.parse(output)

  if (typeof parsed['test-count'] !== 'number' || parsed['test-count'] < 1) {
    fail(`No Rust tests matched filter: ${filter}`)
  }
}

function runTrackedTest(inputPath) {
  const { relativePath } = resolveTrackedPath(inputPath)
  const classification = classifyTrackedTestPath(relativePath)
  const command = buildTrackedTestCommand(relativePath)

  if (classification.kind === 'rust') {
    ensureRustMatches(classification.target.filter)
  }

  return (
    runCommand(command.command, command.args, {
      cwd: command.cwd ? resolve(process.cwd(), command.cwd) : process.cwd(),
      env: classification.kind === 'rust' ? RUST_ENV : classification.kind === 'frontend' ? FRONTEND_ENV : process.env,
    }).status ?? 1
  )
}

function runTrackedGroup(groupName, paths) {
  if (paths.length === 0) {
    return 0
  }

  console.log(`Running tracked ${groupName} tests...`)

  for (const path of paths) {
    const status = runTrackedTest(path)

    if (status !== 0) {
      return status
    }
  }

  return 0
}

function runTrackedSuite() {
  const trackedPaths = readTrackedPaths()

  if (trackedPaths.length === 0) {
    console.log('No tracked tests registered.')
    return 0
  }

  const frontendPaths = []
  const rustPaths = []

  for (const path of trackedPaths) {
    const { relativePath } = resolveTrackedPath(path)
    const classification = classifyTrackedTestPath(relativePath)

    if (classification.kind === 'rust') {
      rustPaths.push(path)
    } else {
      frontendPaths.push(path)
    }
  }

  const frontendStatus = runTrackedGroup('TypeScript', frontendPaths)

  if (frontendStatus !== 0) {
    return frontendStatus
  }

  return runTrackedGroup('Rust', rustPaths)
}

const [command, ...args] = process.argv.slice(2)

if (command === 'track') {
  const trackedPath = trackPath(args[0] ?? '')
  process.exit(runTrackedTest(trackedPath))
}

if (command === 'untrack') {
  untrackPath(args[0] ?? '')
  process.exit(0)
}

if (command === 'clear') {
  clearTrackedPaths()
  process.exit(0)
}

if (command === 'run-tracked') {
  process.exit(runTrackedSuite())
}

fail('Usage: scripts/tracked-tests.js <track|untrack|clear|run-tracked> [path]')
