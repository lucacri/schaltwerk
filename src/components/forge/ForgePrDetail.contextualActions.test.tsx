import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../tests/test-utils'
import type { ForgePrDetails, ForgeProviderData } from '../../types/forgeTypes'

const contextualActionButtonPropsSpy = vi.fn()

vi.mock('./ContextualActionButton', () => ({
  ContextualActionButton: (props: { context: 'pr' | 'issue'; variables: Record<string, string> }) => {
    contextualActionButtonPropsSpy(props)
    return <div data-testid="contextual-action-button" />
  },
}))

const { ForgePrDetail } = await import('./ForgePrDetail')

function githubProvider(overrides: Partial<Extract<ForgeProviderData, { type: 'GitHub' }>> = {}): ForgeProviderData {
  return { type: 'GitHub', statusChecks: [], isFork: false, ...overrides }
}

function makeDetails(overrides: Partial<ForgePrDetails> = {}): ForgePrDetails {
  return {
    summary: {
      id: '42',
      title: 'Unify contextual actions',
      state: 'OPEN',
      author: 'carol',
      labels: [
        { name: 'review' },
        { name: 'backend' },
      ],
      sourceBranch: 'feature/unify-context',
      targetBranch: 'main',
      url: 'https://github.com/owner/repo/pull/42',
    },
    body: 'Please review end-to-end behavior.',
    reviews: [],
    reviewComments: [],
    providerData: githubProvider(),
    ...overrides,
  }
}

describe('ForgePrDetail contextual action variables', () => {
  beforeEach(() => {
    contextualActionButtonPropsSpy.mockClear()
  })

  it('passes the unified pr.* variable set to contextual actions', () => {
    renderWithProviders(
      <ForgePrDetail details={makeDetails()} onBack={() => undefined} forgeType="github" />,
      { forgeOverrides: { hasRepository: true } }
    )

    expect(contextualActionButtonPropsSpy).toHaveBeenCalled()
    const props = contextualActionButtonPropsSpy.mock.calls[0][0] as {
      context: string
      variables: Record<string, string>
    }

    expect(props.context).toBe('pr')
    expect(props.variables).toMatchObject({
      'pr.number': '42',
      'pr.title': 'Unify contextual actions',
      'pr.description': 'Please review end-to-end behavior.',
      'pr.author': 'carol',
      'pr.sourceBranch': 'feature/unify-context',
      'pr.targetBranch': 'main',
      'pr.url': 'https://github.com/owner/repo/pull/42',
      'pr.labels': 'review, backend',
    })
  })
})
