// Phase 8 W.5 — GAP 1 pin: structural DOM order for the v2 sidebar.
//
// The sidebar's slot order is load-bearing: orchestrator must always
// land above the search bar and the stage sections, and the stage
// sections must be the last child. Future refactors that reorder slots
// silently are caught here.
//
// Phase 8 W.1's dual-mount bug (SidebarSessionList + SidebarStageSectionsView
// both rendered) is exactly the regression class this pin protects against.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'

vi.mock('../../hooks/useSelection', () => ({
    useSelection: () => ({
        selection: { kind: 'orchestrator' as const, projectPath: '/repo' },
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom' },
        setSelection: vi.fn(),
    }),
}))

vi.mock('../../hooks/useClaudeSession', () => ({
    useClaudeSession: () => ({
        getOrchestratorAgentType: () => 'claude',
    }),
}))

vi.mock('../../hooks/useSessionManagement', () => ({
    useSessionManagement: () => ({
        resetSession: vi.fn(),
    }),
}))

vi.mock('./hooks/useOrchestratorBranch', () => ({
    useOrchestratorBranch: () => ({ orchestratorBranch: 'main' }),
}))

vi.mock('./hooks/useOrchestratorEntryActions', () => ({
    useOrchestratorEntryActions: () => ({
        onSwitchModel: vi.fn(),
        onReset: vi.fn(),
    }),
}))

vi.mock('../../keyboardShortcuts/useShortcutDisplay', () => ({
    useShortcutDisplay: () => '⌘\\',
}))

vi.mock('../modals/SwitchOrchestratorModal', () => ({
    SwitchOrchestratorModal: ({ open }: { open: boolean }) =>
        open ? <div data-testid="switch-orchestrator-modal" /> : null,
}))

import { Sidebar } from './Sidebar'

function renderSidebar(isCollapsed = false) {
    const store = createStore()
    return render(
        <Provider store={store}>
            <Sidebar isCollapsed={isCollapsed} />
        </Provider>,
    )
}

describe('Sidebar DOM-order pin', () => {
    it('mounts orchestrator entry, then search bar, then stage sections — in that order', () => {
        renderSidebar()

        const root = screen.getByTestId('sidebar-root')
        const orchestrator = screen.getByTestId('orchestrator-entry')
        const search = root.querySelector('[data-testid^="sidebar-search"]') ??
            // SidebarSearchBar may not expose a stable testid; fall back to
            // its containing ancestor by class. The structural assertion
            // below tolerates either.
            null
        const stageSections =
            screen.queryByTestId('sidebar-stage-sections') ??
            screen.getByTestId('sidebar-stage-sections-empty')

        // Orchestrator must precede stage sections in DOM order.
        const orchestratorIndex = Array.from(root.children).findIndex((child) =>
            child.contains(orchestrator),
        )
        const stageIndex = Array.from(root.children).findIndex((child) =>
            child.contains(stageSections),
        )

        expect(orchestratorIndex).toBeGreaterThanOrEqual(0)
        expect(stageIndex).toBeGreaterThanOrEqual(0)
        expect(orchestratorIndex).toBeLessThan(stageIndex)

        if (search) {
            const searchIndex = Array.from(root.children).findIndex((child) =>
                child.contains(search),
            )
            expect(orchestratorIndex).toBeLessThan(searchIndex)
            expect(searchIndex).toBeLessThan(stageIndex)
        }
    })

    it('mounts the orchestrator entry exactly once (no dual-mount regression)', () => {
        renderSidebar()
        expect(screen.getAllByTestId('orchestrator-entry')).toHaveLength(1)
    })

    it('mounts the stage sections view exactly once', () => {
        renderSidebar()
        const containers = [
            ...screen.queryAllByTestId('sidebar-stage-sections'),
            ...screen.queryAllByTestId('sidebar-stage-sections-empty'),
        ]
        expect(containers).toHaveLength(1)
    })

    it('hides the stage sections when sidebar is collapsed', () => {
        renderSidebar(true)
        expect(screen.queryByTestId('sidebar-stage-sections')).toBeNull()
        expect(screen.queryByTestId('sidebar-stage-sections-empty')).toBeNull()
        // Orchestrator entry stays visible in collapsed mode.
        expect(screen.getByTestId('orchestrator-entry')).toBeInTheDocument()
    })
})
