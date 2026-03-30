import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tab } from './Tab'

describe('Tab', () => {
  const mockProps = {
    projectPath: '/Users/test/project',
    projectName: 'project',
    isActive: false,
    onSelect: vi.fn(),
    onClose: vi.fn()
  }

  it('renders project name', () => {
    render(<Tab {...mockProps} />)
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('shows full path in tooltip', () => {
    render(<Tab {...mockProps} />)
    const button = screen.getByTitle('/Users/test/project')
    expect(button).toBeInTheDocument()
  })

  it('applies active styles when active', () => {
    render(<Tab {...mockProps} isActive={true} />)
    const button = screen.getByTitle('/Users/test/project')
    expect(button.style.backgroundColor).toBe('var(--color-tab-active-bg)')
    expect(button.style.color).toBe('var(--color-tab-active-text)')
  })

  it('applies inactive styles when not active', () => {
    render(<Tab {...mockProps} isActive={false} />)
    const button = screen.getByTitle('/Users/test/project')
    expect(button.style.backgroundColor).toBe('var(--color-tab-inactive-bg)')
    expect(button.style.color).toBe('var(--color-tab-inactive-text)')
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<Tab {...mockProps} onSelect={onSelect} />)
    const button = screen.getByTitle('/Users/test/project')
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(<Tab {...mockProps} onClose={onClose} onSelect={onSelect} />)
    const closeButton = screen.getByTitle('Close project')
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('truncates long project names', () => {
    const longName = 'very-long-project-name-that-should-be-truncated'
    render(<Tab {...mockProps} projectName={longName} />)
    const nameSpan = screen.getByText(longName)
    expect(nameSpan.className).toContain('truncate')
    expect(nameSpan.className).toContain('flex-1')
  })

  it('shows running indicator when runningCount > 0', () => {
    render(<Tab {...mockProps} runningCount={3} />)
    const indicator = screen.getByTestId('running-indicator')
    expect(indicator).toBeInTheDocument()
    expect(screen.queryByTestId('running-badge')).toBeNull()
  })

  it('shows attention badge when attentionCount > 0', () => {
    render(<Tab {...mockProps} attentionCount={2} />)
    const badge = screen.getByTestId('attention-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('2')
    expect(badge.style.backgroundColor).toBe('var(--color-tab-badge-bg)')
    expect(badge.style.color).toBe('var(--color-tab-badge-text)')
  })

  it('shows both running indicator and attention badge when both counts > 0', () => {
    render(<Tab {...mockProps} runningCount={3} attentionCount={1} />)
    expect(screen.getByTestId('running-indicator')).toBeInTheDocument()
    expect(screen.getByTestId('attention-badge')).toBeInTheDocument()
  })

  it('shows no indicators when both counts are 0', () => {
    render(<Tab {...mockProps} runningCount={0} attentionCount={0} />)
    expect(screen.queryByTestId('running-indicator')).toBeNull()
    expect(screen.queryByTestId('attention-badge')).toBeNull()
  })

  it('caps attention badge display at 9+', () => {
    render(<Tab {...mockProps} attentionCount={12} />)
    expect(screen.getByTestId('attention-badge').textContent).toBe('9+')
  })
})
