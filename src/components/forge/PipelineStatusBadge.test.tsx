import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { PipelineStatusBadge } from './PipelineStatusBadge'
import { renderWithProviders } from '../../tests/test-utils'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

function expectNoAnimationAnywhere(badge: HTMLElement) {
  expect(badge.style.animation).toBe('')
  badge.querySelectorAll('*').forEach((el) => {
    expect((el as HTMLElement).style.animation).toBe('')
  })
}

describe('PipelineStatusBadge', () => {
  describe('Tier 1: filled pill (failed, running, manual)', () => {
    it('renders failed status as a filled red pill, no leading dot, no animation', () => {
      renderWithProviders(<PipelineStatusBadge status="failed" />)
      const badge = screen.getByText('Failed')

      expect(badge.style.backgroundColor).toBe('var(--color-accent-red-bg)')
      expect(badge.style.borderColor).toBe('var(--color-accent-red-border)')
      expect(badge.style.color).toBe('var(--color-accent-red)')
      expect(badge.style.borderRadius).toBe('9999px')
      expect(within(badge).queryByTestId('pipeline-leading-dot')).toBeNull()
      expectNoAnimationAnywhere(badge)
    })

    it('renders running status as a filled blue pill, no leading dot, no animation (regression guard)', () => {
      renderWithProviders(<PipelineStatusBadge status="running" />)
      const badge = screen.getByText('Running')

      expect(badge.style.backgroundColor).toBe('var(--color-accent-blue-bg)')
      expect(badge.style.borderColor).toBe('var(--color-accent-blue-border)')
      expect(badge.style.color).toBe('var(--color-accent-blue)')
      expect(within(badge).queryByTestId('pipeline-leading-dot')).toBeNull()
      expectNoAnimationAnywhere(badge)
    })

    it('renders manual status as a filled amber pill, no leading dot, no animation', () => {
      renderWithProviders(<PipelineStatusBadge status="manual" />)
      const badge = screen.getByText('Manual')

      expect(badge.style.backgroundColor).toBe('var(--color-accent-amber-bg)')
      expect(badge.style.borderColor).toBe('var(--color-accent-amber-border)')
      expect(badge.style.color).toBe('var(--color-accent-amber)')
      expect(within(badge).queryByTestId('pipeline-leading-dot')).toBeNull()
      expectNoAnimationAnywhere(badge)
    })
  })

  describe('Tier 2: outlined amber pill (pending, created, waiting_for_resource, preparing)', () => {
    it.each([
      ['pending'],
      ['created'],
      ['waiting_for_resource'],
      ['preparing'],
    ])('renders "%s" as outlined amber pill with leading dot', (status) => {
      renderWithProviders(<PipelineStatusBadge status={status} />)
      const badge = screen.getByText('Pending')

      expect(badge.style.backgroundColor).toBe('transparent')
      expect(badge.style.borderColor).toBe('var(--color-accent-amber-border)')
      expect(badge.style.color).toBe('var(--color-accent-amber)')
      expect(badge.style.borderRadius).toBe('9999px')
      expect(within(badge).getByTestId('pipeline-leading-dot')).toBeTruthy()
    })
  })

  describe('Tier 3: text + dot (success, canceled, unknown)', () => {
    it('renders success status as green text with leading dot, no pill chrome', () => {
      renderWithProviders(<PipelineStatusBadge status="success" />)
      const badge = screen.getByText('Passed')

      expect(badge.style.backgroundColor).toBe('')
      expect(badge.style.borderColor).toBe('')
      expect(badge.style.color).toBe('var(--color-accent-green)')
      expect(within(badge).getByTestId('pipeline-leading-dot')).toBeTruthy()
    })

    it('renders canceled status as muted text with leading dot, no pill chrome', () => {
      renderWithProviders(<PipelineStatusBadge status="canceled" />)
      const badge = screen.getByText('Canceled')

      expect(badge.style.backgroundColor).toBe('')
      expect(badge.style.borderColor).toBe('')
      expect(badge.style.color).toBe('var(--color-text-muted)')
      expect(within(badge).getByTestId('pipeline-leading-dot')).toBeTruthy()
    })

    it('renders unknown status as muted text with raw status as label and leading dot', () => {
      renderWithProviders(<PipelineStatusBadge status="something_weird" />)
      const badge = screen.getByText('something_weird')

      expect(badge.style.backgroundColor).toBe('')
      expect(badge.style.borderColor).toBe('')
      expect(badge.style.color).toBe('var(--color-text-muted)')
      expect(within(badge).getByTestId('pipeline-leading-dot')).toBeTruthy()
    })
  })

  describe('URL wrapping', () => {
    it('wraps in link when url is provided', () => {
      renderWithProviders(<PipelineStatusBadge status="success" url="https://gitlab.example.com/pipeline/1" />)
      const badge = screen.getByText('Passed')
      expect(badge.closest('a')).toBeTruthy()
    })

    it('renders without link when url is not provided', () => {
      renderWithProviders(<PipelineStatusBadge status="success" />)
      const badge = screen.getByText('Passed')
      expect(badge.closest('a')).toBeNull()
    })

    it('wraps tier 1 filled pill in link when url is provided', () => {
      renderWithProviders(<PipelineStatusBadge status="failed" url="https://gitlab.example.com/pipeline/1" />)
      const badge = screen.getByText('Failed')
      expect(badge.closest('a')).toBeTruthy()
    })
  })
})
