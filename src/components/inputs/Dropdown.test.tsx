import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Dropdown } from './Dropdown'

function DropdownHarness() {
  const [open, setOpen] = useState(false)

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      items={[
        { key: 'one', label: 'One' },
        { key: 'two', label: 'Two' },
      ]}
      onSelect={() => setOpen(false)}
      menuTestId="dropdown-menu"
    >
      {({ toggle }) => (
        <button type="button" onClick={toggle}>
          Toggle
        </button>
      )}
    </Dropdown>
  )
}

describe('Dropdown', () => {
  test('renders the menu using a portal positioned relative to the viewport', async () => {
    const user = userEvent.setup()
    render(<DropdownHarness />)

    await user.click(screen.getByRole('button', { name: 'Toggle' }))

    const menu = await screen.findByTestId('dropdown-menu')

    expect(menu.parentElement).toBe(document.body)
    expect(window.getComputedStyle(menu).position).toBe('fixed')
  })

  test('closes when the overlay backdrop is clicked', async () => {
    const user = userEvent.setup()
    render(<DropdownHarness />)

    await user.click(screen.getByRole('button', { name: 'Toggle' }))

    const menu = await screen.findByTestId('dropdown-menu')
    const overlay = screen.getByTestId('dropdown-menu-backdrop')

    expect(menu).toBeInTheDocument()

    await user.click(overlay)

    expect(screen.queryByTestId('dropdown-menu')).toBeNull()
  })

  test('closes when escape is pressed', async () => {
    const user = userEvent.setup()
    render(<DropdownHarness />)

    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    await screen.findByTestId('dropdown-menu')

    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('dropdown-menu')).toBeNull()
  })
})
