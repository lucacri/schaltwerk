import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { SessionAutoFixToggle } from './SessionAutoFixToggle'
import { projectPathAtom } from '../../store/atoms/project'
import type { ReactNode } from 'react'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

const { invoke } = await import('@tauri-apps/api/core')
const mockInvoke = vi.mocked(invoke)

function renderToggle(props: Partial<Parameters<typeof SessionAutoFixToggle>[0]> = {}) {
    const store = createStore()
    store.set(projectPathAtom, '/test/project')

    const defaultProps = {
        sessionName: 'test-session',
        hasPr: true,
        ...props,
    }

    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    )

    return render(<SessionAutoFixToggle {...defaultProps} />, { wrapper: Wrapper })
}

describe('SessionAutoFixToggle', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders nothing when hasPr is false', () => {
        mockInvoke.mockResolvedValueOnce(false)
        renderToggle({ hasPr: false })
        expect(screen.queryByTestId('autofix-toggle')).not.toBeInTheDocument()
    })

    it('loads initial state from backend', async () => {
        mockInvoke.mockResolvedValueOnce(true)
        renderToggle()

        await waitFor(() => {
            expect(screen.getByTestId('autofix-switch')).toBeInTheDocument()
        })
        expect(screen.getByTestId('autofix-switch')).toHaveAttribute('aria-checked', 'true')
    })

    it('toggles state on click and persists to backend', async () => {
        mockInvoke.mockResolvedValueOnce(false)
        renderToggle()

        await waitFor(() => {
            expect(screen.getByTestId('autofix-switch')).toBeInTheDocument()
        })

        mockInvoke.mockResolvedValueOnce(undefined)
        fireEvent.click(screen.getByTestId('autofix-switch'))

        await waitFor(() => {
            expect(screen.getByTestId('autofix-switch')).toHaveAttribute('aria-checked', 'true')
        })

        expect(mockInvoke).toHaveBeenCalledWith('session_set_autofix', {
            sessionName: 'test-session',
            enabled: true,
            projectPath: '/test/project',
        })
    })

    it('reverts state and shows error on backend failure', async () => {
        mockInvoke.mockResolvedValueOnce(false)
        renderToggle()

        await waitFor(() => {
            expect(screen.getByTestId('autofix-switch')).toBeInTheDocument()
        })

        mockInvoke.mockRejectedValueOnce(new Error('DB error'))
        fireEvent.click(screen.getByTestId('autofix-switch'))

        await waitFor(() => {
            expect(screen.getByTestId('autofix-error')).toBeInTheDocument()
        })
        expect(screen.getByTestId('autofix-switch')).toHaveAttribute('aria-checked', 'false')
    })
})
