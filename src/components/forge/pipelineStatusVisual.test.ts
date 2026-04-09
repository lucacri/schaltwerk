import { describe, it, expect } from 'vitest'
import { getPipelineStatusVisual } from './pipelineStatusVisual'

describe('getPipelineStatusVisual', () => {
  describe('Tier 1: filled pill + tinted row', () => {
    it('maps "failed" to filled red pill with red row tint', () => {
      const visual = getPipelineStatusVisual('failed')
      expect(visual.tier).toBe(1)
      expect(visual.labelKey).toBe('pipelineFailed')
      expect(visual.fallbackLabel).toBe('')
      expect(visual.pillBg).toBe('var(--color-accent-red-bg)')
      expect(visual.pillBorder).toBe('var(--color-accent-red-border)')
      expect(visual.pillText).toBe('var(--color-accent-red)')
      expect(visual.rowTintVar).toBe('var(--color-row-tint-red)')
      expect(visual.showLeadingDot).toBe(false)
    })

    it('maps "running" to filled blue pill with blue row tint', () => {
      const visual = getPipelineStatusVisual('running')
      expect(visual.tier).toBe(1)
      expect(visual.labelKey).toBe('pipelineRunning')
      expect(visual.fallbackLabel).toBe('')
      expect(visual.pillBg).toBe('var(--color-accent-blue-bg)')
      expect(visual.pillBorder).toBe('var(--color-accent-blue-border)')
      expect(visual.pillText).toBe('var(--color-accent-blue)')
      expect(visual.rowTintVar).toBe('var(--color-row-tint-blue)')
      expect(visual.showLeadingDot).toBe(false)
    })

    it('maps "manual" to filled amber pill with amber row tint', () => {
      const visual = getPipelineStatusVisual('manual')
      expect(visual.tier).toBe(1)
      expect(visual.labelKey).toBe('pipelineManual')
      expect(visual.fallbackLabel).toBe('')
      expect(visual.pillBg).toBe('var(--color-accent-amber-bg)')
      expect(visual.pillBorder).toBe('var(--color-accent-amber-border)')
      expect(visual.pillText).toBe('var(--color-accent-amber)')
      expect(visual.rowTintVar).toBe('var(--color-row-tint-amber)')
      expect(visual.showLeadingDot).toBe(false)
    })
  })

  describe('Tier 2: outlined amber pill, no row tint', () => {
    it.each([
      ['pending'],
      ['created'],
      ['waiting_for_resource'],
      ['preparing'],
    ])('maps "%s" to outlined amber pill with no row tint', (status) => {
      const visual = getPipelineStatusVisual(status)
      expect(visual.tier).toBe(2)
      expect(visual.labelKey).toBe('pipelinePending')
      expect(visual.fallbackLabel).toBe('')
      expect(visual.pillBg).toBeNull()
      expect(visual.pillBorder).toBe('var(--color-accent-amber-border)')
      expect(visual.pillText).toBe('var(--color-accent-amber)')
      expect(visual.rowTintVar).toBeNull()
      expect(visual.showLeadingDot).toBe(true)
    })
  })

  describe('Tier 3: text + dot, no row tint', () => {
    it('maps "success" to green text + dot with no row tint', () => {
      const visual = getPipelineStatusVisual('success')
      expect(visual.tier).toBe(3)
      expect(visual.labelKey).toBe('pipelineSuccess')
      expect(visual.fallbackLabel).toBe('')
      expect(visual.pillBg).toBeNull()
      expect(visual.pillBorder).toBeNull()
      expect(visual.pillText).toBe('var(--color-accent-green)')
      expect(visual.rowTintVar).toBeNull()
      expect(visual.showLeadingDot).toBe(true)
    })

    it('maps "canceled" to muted text + dot with no row tint', () => {
      const visual = getPipelineStatusVisual('canceled')
      expect(visual.tier).toBe(3)
      expect(visual.labelKey).toBe('pipelineCanceled')
      expect(visual.fallbackLabel).toBe('')
      expect(visual.pillBg).toBeNull()
      expect(visual.pillBorder).toBeNull()
      expect(visual.pillText).toBe('var(--color-text-muted)')
      expect(visual.rowTintVar).toBeNull()
      expect(visual.showLeadingDot).toBe(true)
    })

    it('maps unknown status to muted text + dot, raw status as fallback label', () => {
      const visual = getPipelineStatusVisual('something_weird')
      expect(visual.tier).toBe(3)
      expect(visual.labelKey).toBe('')
      expect(visual.fallbackLabel).toBe('something_weird')
      expect(visual.pillBg).toBeNull()
      expect(visual.pillBorder).toBeNull()
      expect(visual.pillText).toBe('var(--color-text-muted)')
      expect(visual.rowTintVar).toBeNull()
      expect(visual.showLeadingDot).toBe(true)
    })
  })
})
