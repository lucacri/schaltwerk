import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('tracked test wiring', () => {
  it('adds dedicated just recipes and prioritizes tracked tests before the suite phases', () => {
    const justfile = readFileSync(join(process.cwd(), 'justfile'), 'utf8')

    expect(justfile).toContain('test-track path:')
    expect(justfile).toContain('test-untrack path:')
    expect(justfile).toContain('test-clear:')
    expect(justfile).toContain('if [[ -s .tracked-tests ]]; then')
    expect(justfile).toContain('step "Tracked tests"')
    expect(justfile).toContain('scripts/tracked-tests.sh run-tracked')

    const trackedIndex = justfile.indexOf('step "Tracked tests"')
    const depsIndex = justfile.indexOf('step "Dependencies"')
    const frontendIndex = justfile.indexOf('step "Test: Frontend"')

    expect(trackedIndex).toBeGreaterThan(-1)
    expect(depsIndex).toBeGreaterThan(-1)
    expect(frontendIndex).toBeGreaterThan(trackedIndex)
    expect(trackedIndex).toBeGreaterThan(depsIndex)
  })

  it('gitignores tracked test state and enables local nextest fail-fast', () => {
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8')
    const nextestConfig = readFileSync(join(process.cwd(), 'src-tauri/.config/nextest.toml'), 'utf8')

    expect(gitignore).toContain('.tracked-tests')
    expect(nextestConfig).toContain('[profile.default]')
    expect(nextestConfig).toContain('fail-fast = true')
  })
})
