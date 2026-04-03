import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FontPicker } from './FontPicker'

describe('FontPicker', () => {
  it('filters and selects a font', async () => {
    const load = vi.fn().mockResolvedValue([
      { family: 'JetBrains Mono', monospace: true },
      { family: 'Arial', monospace: false },
    ])
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<FontPicker load={load} onSelect={onSelect} onClose={onClose} />)

    await waitFor(() => expect(load).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText('Search installed fonts'), { target: { value: 'jet' } })
    const item = await screen.findByText('JetBrains Mono')
    fireEvent.click(item)
    expect(onSelect).toHaveBeenCalledWith('JetBrains Mono')
  })

  it('renders the monospace filter with shared checkbox chrome', async () => {
    const load = vi.fn().mockResolvedValue([
      { family: 'JetBrains Mono', monospace: true },
    ])

    render(<FontPicker load={load} onSelect={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(load).toHaveBeenCalled())
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveClass('peer', 'sr-only')
  })
})
