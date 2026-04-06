import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('package scripts', () => {
  it('exposes a dedicated style guide command', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['style-guide']).toBe('vite --open /style-guide.html?theme=darcula')
  })

  it('does not expose the legacy playground command', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.playground).toBeUndefined()
  })

  it('does not keep the legacy playground files on disk', () => {
    expect(existsSync(join(process.cwd(), 'vite.playground.config.ts'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'playground'))).toBe(false)
  })
})
