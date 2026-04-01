import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../tests/test-utils'
import type { ForgeIssueDetails } from '../../types/forgeTypes'

const contextualActionButtonPropsSpy = vi.fn()

vi.mock('./ContextualActionButton', () => ({
  ContextualActionButton: (props: { context: 'pr' | 'issue'; variables: Record<string, string> }) => {
    contextualActionButtonPropsSpy(props)
    return <div data-testid="contextual-action-button" />
  },
}))

const { ForgeIssueDetail } = await import('./ForgeIssueDetail')

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
    comments: [],
    ...overrides,
  }
}

describe('ForgeIssueDetail contextual action variables', () => {
  beforeEach(() => {
    contextualActionButtonPropsSpy.mockClear()
  })

  it('passes the unified issue.* variable set to contextual actions', () => {
    renderWithProviders(
      <ForgeIssueDetail details={makeDetails()} onBack={() => undefined} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(contextualActionButtonPropsSpy).toHaveBeenCalled()
    const props = contextualActionButtonPropsSpy.mock.calls[0][0] as {
      context: string
      variables: Record<string, string>
    }

    expect(props.context).toBe('issue')
    expect(props.variables).toMatchObject({
      'issue.number': '42',
      'issue.title': 'Fix login bug',
      'issue.description': 'The login form crashes on submit.',
      'issue.author': 'alice',
      'issue.labels': 'bug, urgent',
      'issue.url': 'https://github.com/owner/repo/issues/42',
    })
  })
})
