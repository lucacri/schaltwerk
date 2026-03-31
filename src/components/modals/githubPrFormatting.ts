import type { GithubPrDetails, GithubPrSummary } from '../../types/githubIssues'
import { loadGenerationPrompts, renderGenerationPrompt } from '../../common/generationPrompts'
import { formatDateTime } from '../../utils/dateTime'

export interface PrReviewComment {
  id: number
  path: string
  line: number | null
  body: string
  author: string | null
  createdAt: string
  htmlUrl: string
  inReplyToId: number | null
}

export function formatPrReviewCommentsForTerminal(
  comments: PrReviewComment[],
  prNumber: number
): string {
  let formatted = `\n# PR Review Comments (PR #${prNumber})\n\n`

  const commentsByFile = comments.reduce((acc, c) => {
    if (!acc[c.path]) acc[c.path] = []
    acc[c.path].push(c)
    return acc
  }, {} as Record<string, PrReviewComment[]>)

  for (const [file, fileComments] of Object.entries(commentsByFile)) {
    formatted += `## ${file}\n\n`
    const topLevel = fileComments.filter(c => c.inReplyToId === null)
    const repliesById = new Map<number, PrReviewComment[]>()

    for (const c of fileComments) {
      if (c.inReplyToId !== null) {
        const existing = repliesById.get(c.inReplyToId) ?? []
        existing.push(c)
        repliesById.set(c.inReplyToId, existing)
      }
    }

    for (const c of topLevel) {
      const location = c.line ? `Line ${c.line}` : 'General'
      const author = c.author ? `@${c.author}` : 'Unknown'
      formatted += `### ${location}:\n**${author}:** ${c.body}\n\n`

      const threadReplies = repliesById.get(c.id) ?? []
      for (const reply of threadReplies) {
        const replyAuthor = reply.author ? `@${reply.author}` : 'Unknown'
        formatted += `  > **${replyAuthor} (reply):** ${reply.body}\n\n`
      }
    }
  }

  return formatted
}

export function formatPrReviewCommentsForClipboard(
  comments: PrReviewComment[]
): string {
  return comments.map(c => {
    const location = c.line ? `${c.path}:${c.line}` : c.path
    const author = c.author ? `@${c.author}` : 'Unknown'
    return `## ${location}\n**${author}**: ${c.body}`
  }).join('\n\n---\n\n')
}

function buildLabelsSection(details: GithubPrDetails): string {
  if (details.labels.length === 0) {
    return ''
  }

  const maxWidth = 80
  const labelTokens = details.labels.map(label => `[${label.name}]`)
  let currentLine = 'Labels:'

  labelTokens.forEach(token => {
    const tokenWithSpace = `${currentLine} ${token}`
    if (tokenWithSpace.length <= maxWidth) {
      currentLine = tokenWithSpace
    } else {
      currentLine += `\n        ${token}`
    }
  })

  return currentLine
}

function buildCommentsSection(details: GithubPrDetails): string {
  if (details.comments.length === 0) {
    return ''
  }

  const sections = details.comments.map(comment => {
    const author = comment.author?.trim() ? comment.author : 'Unknown author'
    return [
      `Comment by ${author} (${comment.createdAt}):`,
      comment.body.trim() ? comment.body : '_No comment provided._',
    ].join('\n')
  })

  return `---\n\n${sections.join('\n\n')}`
}

export function buildPrPromptFromTemplate(details: GithubPrDetails, template: string): string {
  return renderGenerationPrompt(template, {
    title: details.title,
    number: String(details.number),
    url: details.url,
    branch: details.headRefName,
    body: details.body.trim() ? details.body : '_No description provided._',
    labels: details.labels.map(label => label.name).join(', '),
    comments: details.comments
      .map(comment => {
        const author = comment.author?.trim() ? comment.author : 'Unknown author'
        const body = comment.body.trim() ? comment.body : '_No comment provided._'
        return `Comment by ${author} (${comment.createdAt}):\n${body}`
      })
      .join('\n\n'),
    labelsSection: buildLabelsSection(details),
    commentsSection: buildCommentsSection(details),
  }).trim()
}

export async function buildPrPrompt(details: GithubPrDetails): Promise<string> {
  const prompts = await loadGenerationPrompts()
  return buildPrPromptFromTemplate(details, prompts.pr_prompt)
}

export function buildPrPreview(details: GithubPrDetails): string {
  const segments: string[] = []

  segments.push('### PR Description')
  segments.push(details.body.trim() ? details.body : '_No description provided._')

  if (details.labels.length > 0) {
    const labelTokens = details.labels.map(label => `\`${label.name}\``)
    segments.push('')
    segments.push(`**Labels:** ${labelTokens.join(' ')}`)
  }

  if (details.comments.length > 0) {
    segments.push('')
    segments.push('---')
    segments.push('')
    details.comments.forEach((comment, index) => {
      const author = comment.author?.trim() ? comment.author : 'Unknown author'
      segments.push(`**Comment ${index + 1}**`)
      segments.push(`_by ${author} on ${comment.createdAt}_`)
      segments.push('')
      segments.push(comment.body.trim() ? comment.body : '_No comment provided._')
      segments.push('')
    })
  }

  return segments.join('\n').trim()
}

export function formatPrUpdatedTimestamp(summary: GithubPrSummary): string {
  return formatDateTime(summary.updatedAt, undefined, summary.updatedAt)
}
