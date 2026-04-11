import { relative, resolve } from 'node:path'

export type RustTrackedTestTarget = {
  filter: string
  kind: 'integration' | 'unit'
}

export type TrackedTestClassification =
  | {
      kind: 'frontend'
      path: string
    }
  | {
      kind: 'mcp'
      relativePath: string
    }
  | {
      kind: 'rust'
      path: string
      target: RustTrackedTestTarget
    }

export type TrackedTestCommand = {
  args: string[]
  command: string
  cwd?: string
}

const MCP_PREFIX = 'mcp-server/'
const RUST_SOURCE_PREFIX = 'src-tauri/src/'
const RUST_TESTS_PREFIX = 'src-tauri/tests/'

function normalizeTrackedPath(input: string): string {
  return input.trim().replace(/^\.\//, '').replaceAll('\\', '/')
}

export function toTrackedStoragePath(repoRoot: string, inputPath: string): string {
  return normalizeTrackedPath(relative(repoRoot, resolve(repoRoot, inputPath)))
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function deriveRustTrackedTestTarget(inputPath: string): RustTrackedTestTarget {
  const path = normalizeTrackedPath(inputPath)

  if (!path.endsWith('.rs')) {
    throw new Error(`Unsupported Rust tracked test path: ${inputPath}`)
  }

  if (path.startsWith(RUST_SOURCE_PREFIX)) {
    const modulePath = path.slice(RUST_SOURCE_PREFIX.length)

    if (modulePath === 'main.rs' || modulePath === 'lib.rs') {
      throw new Error(`Rust crate roots are too broad to track directly: ${inputPath}`)
    }

    const withoutExtension = modulePath.slice(0, -'.rs'.length)
    const collapsedModule = withoutExtension.endsWith('/mod')
      ? withoutExtension.slice(0, -'/mod'.length)
      : withoutExtension

    if (collapsedModule.length === 0) {
      throw new Error(`Rust crate roots are too broad to track directly: ${inputPath}`)
    }

    return {
      filter: `test(/${escapeRegexLiteral(collapsedModule.replaceAll('/', '::'))}/)`,
      kind: 'unit',
    }
  }

  if (path.startsWith(RUST_TESTS_PREFIX)) {
    const binaryName = path.slice(RUST_TESTS_PREFIX.length, -'.rs'.length)

    if (binaryName.length === 0 || binaryName.includes('/')) {
      throw new Error(`Unsupported Rust tracked test path: ${inputPath}`)
    }

    return {
      filter: `binary(${binaryName})`,
      kind: 'integration',
    }
  }

  throw new Error(`Unsupported Rust tracked test path: ${inputPath}`)
}

export function classifyTrackedTestPath(inputPath: string): TrackedTestClassification {
  const path = normalizeTrackedPath(inputPath)

  if (path.startsWith(MCP_PREFIX) && (path.endsWith('.ts') || path.endsWith('.tsx'))) {
    return {
      kind: 'mcp',
      relativePath: path.slice(MCP_PREFIX.length),
    }
  }

  if (path.endsWith('.ts') || path.endsWith('.tsx')) {
    return {
      kind: 'frontend',
      path,
    }
  }

  if (path.endsWith('.rs')) {
    return {
      kind: 'rust',
      path,
      target: deriveRustTrackedTestTarget(path),
    }
  }

  throw new Error(`Unsupported tracked test path: ${inputPath}`)
}

export function buildTrackedTestCommand(inputPath: string): TrackedTestCommand {
  const classification = classifyTrackedTestPath(inputPath)

  if (classification.kind === 'mcp') {
    return {
      args: ['test', '--bail', classification.relativePath],
      command: 'bun',
      cwd: 'mcp-server',
    }
  }

  if (classification.kind === 'frontend') {
    return {
      args: ['run', 'test:frontend', '--', classification.path],
      command: 'bun',
    }
  }

  return {
    args: [
      'nextest',
      'run',
      '--cargo-quiet',
      '--status-level',
      'leak',
      '--all-features',
      '-E',
      classification.target.filter,
    ],
    command: 'scripts/cargo-worktree.sh',
  }
}
