import type { GithubIssueDetails, GithubIssueSummary } from '../../types/githubIssues'
import { loadGenerationPrompts, renderGenerationPrompt } from '../../common/generationPrompts'
import { formatDateTime } from '../../utils/dateTime'

function buildLabelsSection(details: GithubIssueDetails): string {
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

function buildCommentsSection(details: GithubIssueDetails): string {
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

export function buildIssuePromptFromTemplate(details: GithubIssueDetails, template: string): string {
  return renderGenerationPrompt(template, {
    title: details.title,
    number: String(details.number),
    url: details.url,
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

export async function buildIssuePrompt(details: GithubIssueDetails): Promise<string> {
  const prompts = await loadGenerationPrompts()
  return buildIssuePromptFromTemplate(details, prompts.issue_prompt)
}

export function buildIssuePreview(details: GithubIssueDetails): string {
  const segments: string[] = []

  segments.push('### Issue Description')
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

export function formatIssueUpdatedTimestamp(summary: GithubIssueSummary): string {
  return formatDateTime(summary.updatedAt, undefined, summary.updatedAt)
}
