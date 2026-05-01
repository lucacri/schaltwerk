import { FilterMode } from '../../../types/sessionFilters'
import { SelectionMemoryEntry } from '../../../utils/selectionMemory'

export const createSelectionMemoryBuckets = (): Record<FilterMode, SelectionMemoryEntry> => ({
    [FilterMode.All]: { lastSelection: null, lastSessions: [] },
    [FilterMode.Spec]: { lastSelection: null, lastSessions: [] },
    [FilterMode.Running]: { lastSelection: null, lastSessions: [] },
})
