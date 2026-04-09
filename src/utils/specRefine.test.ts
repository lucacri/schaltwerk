import { describe, expect, it } from 'vitest'
import { buildSpecRefineReference } from './specRefine'

describe('buildSpecRefineReference', () => {
  it('uses the display name when present', () => {
    expect(buildSpecRefineReference('foo', 'Foo')).toBe('Refine spec: Foo (foo)')
  })

  it('falls back to the session id when display name is blank', () => {
    expect(buildSpecRefineReference('foo', '   ')).toBe('Refine spec: foo (foo)')
  })
})
