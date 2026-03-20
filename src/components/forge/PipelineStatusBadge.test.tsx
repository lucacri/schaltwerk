import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { PipelineStatusBadge } from './PipelineStatusBadge'
import { renderWithProviders } from '../../tests/test-utils'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('PipelineStatusBadge', () => {
  it('renders success status with green color', () => {
    renderWithProviders(<PipelineStatusBadge status="success" />)
    const badge = screen.getByText('Success')
    expect(badge.style.color).toBe('var(--color-accent-green)')
  })

  it('renders failed status with red color', () => {
    renderWithProviders(<PipelineStatusBadge status="failed" />)
    const badge = screen.getByText('Failed')
    expect(badge.style.color).toBe('var(--color-accent-red)')
  })

  it('renders running status with blue color', () => {
    renderWithProviders(<PipelineStatusBadge status="running" />)
    const badge = screen.getByText('Running')
    expect(badge.style.color).toBe('var(--color-accent-blue)')
  })

  it('renders pending status with amber color', () => {
    renderWithProviders(<PipelineStatusBadge status="pending" />)
    const badge = screen.getByText('Pending')
    expect(badge.style.color).toBe('var(--color-accent-amber)')
  })

  it('renders canceled status with muted color', () => {
    renderWithProviders(<PipelineStatusBadge status="canceled" />)
    const badge = screen.getByText('Canceled')
    expect(badge.style.color).toBe('var(--color-text-muted)')
  })

  it('renders manual status with amber color', () => {
    renderWithProviders(<PipelineStatusBadge status="manual" />)
    const badge = screen.getByText('Manual')
    expect(badge.style.color).toBe('var(--color-accent-amber)')
  })

  it('wraps in link when url is provided', () => {
    renderWithProviders(<PipelineStatusBadge status="success" url="https://gitlab.example.com/pipeline/1" />)
    const badge = screen.getByText('Success')
    expect(badge.closest('a')).toBeTruthy()
  })

  it('renders without link when url is not provided', () => {
    renderWithProviders(<PipelineStatusBadge status="success" />)
    const badge = screen.getByText('Success')
    expect(badge.closest('a')).toBeNull()
  })
})
