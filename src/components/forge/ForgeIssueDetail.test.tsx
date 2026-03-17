import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { ForgeIssueDetail } from './ForgeIssueDetail'
import { renderWithProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { ForgeIssueDetails } from '../../types/forgeTypes'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { invoke } = await import('@tauri-apps/api/core')
const mockedInvoke = vi.mocked(invoke)

function makeDetails(overrides: Partial<ForgeIssueDetails> = {}): ForgeIssueDetails {
  return {
    summary: {
      id: '42',
      title: 'Fix login bug',
      state: 'OPEN',
      updatedAt: '2026-03-10T10:00:00Z',
      author: 'alice',
      labels: [
        { name: 'bug', color: 'ff0000' },
        { name: 'urgent' },
      ],
      url: 'https://github.com/owner/repo/issues/42',
    },
    body: 'The login form crashes on submit.',
    comments: [
      { author: 'alice', createdAt: '2026-03-10T10:00:00Z', body: 'I can reproduce this.' },
      { author: 'bob', createdAt: '2026-03-11T12:00:00Z', body: 'Working on a fix.' },
    ],
    ...overrides,
  }
}

describe('ForgeIssueDetail', () => {
  const onBack = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders issue title with #id format', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('#42 Fix login bug')).toBeTruthy()
  })

  it('shows open state badge with green styling for GitHub OPEN', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Open')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-green)')
  })

  it('shows open state badge with green styling for GitLab opened', () => {
    const details = makeDetails({
      summary: { ...makeDetails().summary, state: 'opened' },
    })

    renderWithProviders(
      <ForgeIssueDetail details={details} onBack={onBack} forgeType="gitlab" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Open')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-green)')
  })

  it('shows closed state badge with red styling', () => {
    const details = makeDetails({
      summary: { ...makeDetails().summary, state: 'CLOSED' },
    })

    renderWithProviders(
      <ForgeIssueDetail details={details} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    const badge = screen.getByText('Closed')
    expect(badge).toBeTruthy()
    expect(badge.style.color).toBe('var(--color-accent-red)')
  })

  it('shows labels via ForgeLabelChip', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('bug')).toBeTruthy()
    expect(screen.getByText('urgent')).toBeTruthy()
  })

  it('shows description', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('The login form crashes on submit.')).toBeTruthy()
    expect(screen.getByText('Description')).toBeTruthy()
  })

  it('shows comments with author and date', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('bob')).toBeTruthy()
    expect(screen.getByText('I can reproduce this.')).toBeTruthy()
    expect(screen.getByText('Working on a fix.')).toBeTruthy()
  })

  it('filters empty comments', () => {
    const details = makeDetails({
      comments: [
        { author: 'alice', createdAt: '2026-03-10T10:00:00Z', body: 'Valid comment' },
        { author: 'bob', createdAt: '2026-03-11T12:00:00Z', body: '' },
        { author: 'carol', createdAt: '2026-03-12T12:00:00Z', body: '   ' },
      ],
    })

    renderWithProviders(
      <ForgeIssueDetail details={details} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('Valid comment')).toBeTruthy()
    expect(screen.getByText('Comments (1)')).toBeTruthy()
  })

  it('shows "No comments yet" when empty', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails({ comments: [] })} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('No comments yet')).toBeTruthy()
  })

  it('back button calls onBack', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Back to list'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('open in browser button invokes OpenExternalUrl', () => {
    mockedInvoke.mockResolvedValue(undefined)

    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    fireEvent.click(screen.getByText('Open in browser'))
    expect(mockedInvoke).toHaveBeenCalledWith(
      TauriCommands.OpenExternalUrl,
      { url: 'https://github.com/owner/repo/issues/42' }
    )
  })

  it('shows sourceLabel badge when provided', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={onBack} forgeType="gitlab" sourceLabel="my-project" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(screen.getByText('my-project')).toBeTruthy()
  })
})
