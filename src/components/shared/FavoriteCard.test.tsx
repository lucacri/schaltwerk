import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FavoriteCard } from './FavoriteCard'

describe('FavoriteCard', () => {
    it('renders the favorite label, shortcut, and summary', () => {
        render(
            <FavoriteCard
                title="Codex Fast"
                shortcut="⌘2"
                summary="GPT-5.4 · high"
                accentColor="var(--color-accent-violet)"
                onClick={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: /Codex Fast/i })).toBeInTheDocument()
        expect(screen.getByText('⌘2')).toBeInTheDocument()
        expect(screen.getByText('GPT-5.4 · high')).toBeInTheDocument()
    })

    it('shows a modified badge when overrides are active', () => {
        render(
            <FavoriteCard
                title="Review Squad"
                shortcut="⌘3"
                summary="2 agents · skip"
                accentColor="var(--color-accent-blue)"
                modified
                onClick={vi.fn()}
            />
        )

        expect(screen.getByText(/modified/i)).toBeInTheDocument()
    })

    it('disables selection when the favorite is unavailable', () => {
        const onClick = vi.fn()

        render(
            <FavoriteCard
                title="Gemini Triage"
                shortcut="⌘4"
                summary="1 agent"
                accentColor="var(--color-accent-amber)"
                disabled
                tooltip="Gemini is not on PATH"
                onClick={onClick}
            />
        )

        const button = screen.getByRole('button', { name: /Gemini Triage/i })
        fireEvent.click(button)

        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('title', 'Gemini is not on PATH')
        expect(onClick).not.toHaveBeenCalled()
    })
})
