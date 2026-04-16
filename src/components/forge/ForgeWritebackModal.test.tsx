import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ForgeWritebackModal } from './ForgeWritebackModal'
import { projectPathAtom } from '../../store/atoms/project'
import { forgeBaseAtom } from '../../store/atoms/forge'
import type { ForgeSourceConfig } from '../../types/forgeTypes'
import type { ReactNode } from 'react'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

const { invoke } = await import('@tauri-apps/api/core')
const mockInvoke = vi.mocked(invoke)

const source: ForgeSourceConfig = {
    projectIdentifier: 'owner/repo',
    hostname: 'github.com',
    label: 'GitHub',
    forgeType: 'github',
}

function renderModal(props: Partial<Parameters<typeof ForgeWritebackModal>[0]> = {}) {
    const store = createStore()
    store.set(projectPathAtom, '/test/project')
    store.set(forgeBaseAtom, 'github')

    const defaultProps = {
        sessionId: 'session-1',
        sessionName: 'test-session',
        prNumber: 42,
        forgeSource: source,
        onClose: vi.fn(),
        ...props,
    }

    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    )

    return { ...render(<ForgeWritebackModal {...defaultProps} />, { wrapper: Wrapper }), props: defaultProps }
}

describe('ForgeWritebackModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders modal with generate button in idle state', () => {
        renderModal()
        expect(screen.getByTestId('forge-writeback-modal')).toBeInTheDocument()
        expect(screen.getByTestId('generate-btn')).toBeInTheDocument()
    })

    it('shows generating state when generate is clicked', async () => {
        mockInvoke.mockImplementation(() => new Promise(() => {}))
        renderModal()

        fireEvent.click(screen.getByTestId('generate-btn'))

        await waitFor(() => {
            expect(screen.getByTestId('generating-state')).toBeInTheDocument()
        })
    })

    it('shows editable textarea after generation completes', async () => {
        mockInvoke.mockResolvedValueOnce('Generated summary text')
        renderModal()

        fireEvent.click(screen.getByTestId('generate-btn'))

        await waitFor(() => {
            expect(screen.getByTestId('editing-state')).toBeInTheDocument()
        })

        const textarea = screen.getByTestId('writeback-textarea') as HTMLTextAreaElement
        expect(textarea.value).toBe('Generated summary text')
    })

    it('does not post when modal is closed without clicking Post', async () => {
        mockInvoke.mockResolvedValueOnce('Generated text')
        const { props } = renderModal()

        fireEvent.click(screen.getByTestId('generate-btn'))
        await waitFor(() => {
            expect(screen.getByTestId('editing-state')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByLabelText('Close'))
        expect(props.onClose).toHaveBeenCalled()
        expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    it('calls forge_comment_on_pr with edited text on Post', async () => {
        mockInvoke.mockResolvedValueOnce('Draft text')
        mockInvoke.mockResolvedValueOnce(undefined)
        const { props } = renderModal()

        fireEvent.click(screen.getByTestId('generate-btn'))
        await waitFor(() => {
            expect(screen.getByTestId('editing-state')).toBeInTheDocument()
        })

        const textarea = screen.getByTestId('writeback-textarea') as HTMLTextAreaElement
        fireEvent.change(textarea, { target: { value: 'Edited text' } })

        fireEvent.click(screen.getByTestId('post-btn'))

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('forge_comment_on_pr', {
                projectPath: '/test/project',
                source,
                id: '42',
                message: 'Edited text',
            })
        })
        expect(props.onClose).toHaveBeenCalled()
    })

    it('calls forge_comment_on_issue when target is issue', async () => {
        mockInvoke.mockResolvedValueOnce('Draft text')
        mockInvoke.mockResolvedValueOnce(undefined)
        renderModal({ prNumber: undefined, issueNumber: 7 })

        fireEvent.click(screen.getByTestId('generate-btn'))
        await waitFor(() => {
            expect(screen.getByTestId('editing-state')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('post-btn'))

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('forge_comment_on_issue', expect.objectContaining({
                id: '7',
            }))
        })
    })

    it('shows error state with retry on generation failure', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('Generation failed'))
        renderModal()

        fireEvent.click(screen.getByTestId('generate-btn'))

        await waitFor(() => {
            expect(screen.getByTestId('error-state')).toBeInTheDocument()
        })
        expect(screen.getByTestId('retry-btn')).toBeInTheDocument()
    })

    it('shows target selector when both pr and issue are present', () => {
        renderModal({ prNumber: 42, issueNumber: 7 })
        expect(screen.getByTestId('target-selector')).toBeInTheDocument()
    })

    it('does not show target selector when only pr is present', () => {
        renderModal({ prNumber: 42 })
        expect(screen.queryByTestId('target-selector')).not.toBeInTheDocument()
    })

    it('disables Post button when draft is empty', async () => {
        mockInvoke.mockResolvedValueOnce('')
        renderModal()

        fireEvent.click(screen.getByTestId('generate-btn'))
        await waitFor(() => {
            expect(screen.getByTestId('editing-state')).toBeInTheDocument()
        })

        const postBtn = screen.getByTestId('post-btn')
        expect(postBtn).toBeDisabled()
    })
})
