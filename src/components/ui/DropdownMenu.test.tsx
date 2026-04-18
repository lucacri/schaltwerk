import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropdownMenu, type DropdownMenuItem } from './DropdownMenu'

function buildItems(overrides: Partial<Record<string, Partial<DropdownMenuItem>>> = {}): DropdownMenuItem[] {
  const copy: DropdownMenuItem = { kind: 'action', key: 'copy', label: 'Copy Name', onSelect: () => {}, ...(overrides.copy as Partial<DropdownMenuItem>) }
  const branch: DropdownMenuItem = { kind: 'action', key: 'branch', label: 'Copy Branch', onSelect: () => {}, ...(overrides.branch as Partial<DropdownMenuItem>) }
  const open: DropdownMenuItem = { kind: 'action', key: 'open', label: 'Open in Editor', onSelect: () => {}, ...(overrides.open as Partial<DropdownMenuItem>) }
  const sep: DropdownMenuItem = { kind: 'separator', key: 'sep' }
  const del: DropdownMenuItem = { kind: 'action', key: 'delete', label: 'Delete Session', destructive: true, onSelect: () => {}, ...(overrides.delete as Partial<DropdownMenuItem>) }
  return [copy, branch, open, sep, del]
}

describe('DropdownMenu', () => {
  it('renders action items with role=menuitem and the panel with role=menu', () => {
    render(<DropdownMenu items={buildItems()} onDismiss={() => {}} />)
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((b) => b.textContent)).toEqual([
      'Copy Name',
      'Copy Branch',
      'Open in Editor',
      'Delete Session',
    ])
  })

  it('renders a separator between action groups', () => {
    render(<DropdownMenu items={buildItems()} onDismiss={() => {}} />)
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('applies destructive color to destructive items', () => {
    render(<DropdownMenu items={buildItems()} onDismiss={() => {}} />)
    const deleteBtn = screen.getByRole('menuitem', { name: 'Delete Session' })
    expect((deleteBtn as HTMLElement).style.color).toContain('var(--color-accent-red)')
  })

  it('focuses the first actionable item on open', () => {
    render(<DropdownMenu items={buildItems()} onDismiss={() => {}} />)
    const first = screen.getByRole('menuitem', { name: 'Copy Name' })
    expect(first).toHaveFocus()
  })

  it('supports ArrowDown/ArrowUp navigation that wraps', async () => {
    const user = userEvent.setup()
    render(<DropdownMenu items={buildItems()} onDismiss={() => {}} />)

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Copy Branch' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Open in Editor' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Delete Session' })).toHaveFocus()

    // Wraps around (separator skipped)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Copy Name' })).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Delete Session' })).toHaveFocus()
  })

  it('Home/End jump to first/last actionable item', async () => {
    const user = userEvent.setup()
    render(<DropdownMenu items={buildItems()} onDismiss={() => {}} />)

    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Delete Session' })).toHaveFocus()

    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Copy Name' })).toHaveFocus()
  })

  it('Escape dismisses the menu', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<DropdownMenu items={buildItems()} onDismiss={onDismiss} />)

    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('invokes onSelect and dismisses on click', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    const onDismiss = vi.fn()
    render(
      <DropdownMenu
        items={buildItems({ copy: { kind: 'action', key: 'copy', label: 'Copy Name', onSelect: onCopy } })}
        onDismiss={onDismiss}
      />,
    )

    await user.click(screen.getByRole('menuitem', { name: 'Copy Name' }))
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('skips disabled items in arrow navigation', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu
        items={buildItems({ branch: { kind: 'action', key: 'branch', label: 'Copy Branch', onSelect: () => {}, disabled: true } })}
        onDismiss={() => {}}
      />,
    )

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Open in Editor' })).toHaveFocus()
  })

  it('dismisses on outside click', () => {
    const onDismiss = vi.fn()
    render(
      <>
        <div data-testid="outside" />
        <DropdownMenu items={buildItems()} onDismiss={onDismiss} />
      </>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
