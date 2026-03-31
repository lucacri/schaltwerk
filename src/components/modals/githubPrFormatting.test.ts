import { describe, it, expect } from 'vitest'
import {
  buildPrPromptFromTemplate,
  formatPrReviewCommentsForTerminal,
  formatPrReviewCommentsForClipboard,
  type PrReviewComment
} from './githubPrFormatting'
import type { GithubPrDetails } from '../../types/githubIssues'

const baseDetails: GithubPrDetails = {
  number: 12,
  title: 'Feature: Auth',
  url: 'https://github.com/example/repo/pull/12',
  body: 'PR body',
  state: 'OPEN',
  labels: [{ name: 'backend' }],
  comments: [
    { author: 'alice', createdAt: '2024-01-02T00:00:00Z', body: 'Looks good' },
  ],
  headRefName: 'feature/auth',
  reviewDecision: null,
  statusCheckState: null,
  latestReviews: [],
  isFork: false,
}

describe('githubPrFormatting', () => {
  const createComment = (overrides: Partial<PrReviewComment> = {}): PrReviewComment => ({
    id: 1,
    path: 'src/test.ts',
    line: 10,
    body: 'Test comment',
    author: 'testuser',
    createdAt: '2024-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/owner/repo/pull/1#discussion_r1',
    inReplyToId: null,
    ...overrides
  })

  describe('formatPrReviewCommentsForTerminal', () => {
    it('formats a single comment correctly', () => {
      const comments = [createComment()]
      const result = formatPrReviewCommentsForTerminal(comments, 123)

      expect(result).toContain('# PR Review Comments (PR #123)')
      expect(result).toContain('## src/test.ts')
      expect(result).toContain('### Line 10:')
      expect(result).toContain('**@testuser:** Test comment')
    })

    it('groups comments by file', () => {
      const comments = [
        createComment({ id: 1, path: 'src/a.ts', body: 'Comment A' }),
        createComment({ id: 2, path: 'src/b.ts', body: 'Comment B' }),
        createComment({ id: 3, path: 'src/a.ts', body: 'Comment C', line: 20 })
      ]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('## src/a.ts')
      expect(result).toContain('## src/b.ts')
      expect(result).toContain('Comment A')
      expect(result).toContain('Comment B')
      expect(result).toContain('Comment C')
    })

    it('handles comments without line number', () => {
      const comments = [createComment({ line: null })]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('### General:')
    })

    it('handles comments without author', () => {
      const comments = [createComment({ author: null })]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('**Unknown:**')
    })

    it('formats replies correctly', () => {
      const comments = [
        createComment({ id: 1, body: 'Original comment' }),
        createComment({ id: 2, body: 'This is a reply', inReplyToId: 1, author: 'replier' })
      ]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('**@testuser:** Original comment')
      expect(result).toContain('> **@replier (reply):** This is a reply')
    })

    it('handles multiple replies to the same comment', () => {
      const comments = [
        createComment({ id: 1, body: 'Original' }),
        createComment({ id: 2, body: 'Reply 1', inReplyToId: 1, author: 'user1' }),
        createComment({ id: 3, body: 'Reply 2', inReplyToId: 1, author: 'user2' })
      ]
      const result = formatPrReviewCommentsForTerminal(comments, 1)

      expect(result).toContain('> **@user1 (reply):** Reply 1')
      expect(result).toContain('> **@user2 (reply):** Reply 2')
    })
  })

  describe('formatPrReviewCommentsForClipboard', () => {
    it('formats comments for clipboard', () => {
      const comments = [
        createComment({ path: 'src/test.ts', line: 10, body: 'Comment 1', author: 'user1' }),
        createComment({ id: 2, path: 'src/other.ts', line: null, body: 'Comment 2', author: 'user2' })
      ]
      const result = formatPrReviewCommentsForClipboard(comments)

      expect(result).toContain('## src/test.ts:10')
      expect(result).toContain('**@user1**: Comment 1')
      expect(result).toContain('## src/other.ts')
      expect(result).toContain('**@user2**: Comment 2')
      expect(result).toContain('---')
    })

    it('handles empty author', () => {
      const comments = [createComment({ author: null })]
      const result = formatPrReviewCommentsForClipboard(comments)

      expect(result).toContain('**Unknown**')
    })
  })

  describe('buildPrPromptFromTemplate', () => {
    it('renders the default-style prompt sections from template variables', () => {
      const prompt = buildPrPromptFromTemplate(baseDetails, [
        'GitHub Pull Request Context: {title} (#{number})',
        'Link: {url}',
        'Branch: {branch}',
        '{labelsSection}',
        '',
        'PR Description:',
        '{body}',
        '{commentsSection}',
      ].join('\n'))

      expect(prompt).toContain('GitHub Pull Request Context: Feature: Auth (#12)')
      expect(prompt).toContain('Branch: feature/auth')
      expect(prompt).toContain('Labels: [backend]')
      expect(prompt).toContain('Comment by alice (2024-01-02T00:00:00Z):')
    })

    it('supports custom prompt layouts', () => {
      const prompt = buildPrPromptFromTemplate(baseDetails, 'Title={title}\nBranch={branch}\nComments={comments}')

      expect(prompt).toContain('Title=Feature: Auth')
      expect(prompt).toContain('Branch=feature/auth')
      expect(prompt).toContain('Comments=Comment by alice (2024-01-02T00:00:00Z):')
    })
  })
})
