import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { logger } from '../../utils/logger'

export type SpecEditorViewMode = 'edit' | 'preview' | 'review'
export type SpecEditorPreviewTab = 'content' | 'implementationPlan'

export const SPEC_EDITOR_VIEW_MODE_STORAGE_KEY = 'spec-editor-view-modes'
export const SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY = 'spec-editor-preview-tabs'

const DEFAULT_VIEW_MODE: SpecEditorViewMode = 'preview'
const DEFAULT_PREVIEW_TAB: SpecEditorPreviewTab = 'content'

type ViewModesMap = Map<string, SpecEditorViewMode>
type PreviewTabsMap = Map<string, SpecEditorPreviewTab>
type SpecContentMap = Map<string, string>
type DirtySessions = string[]

function isValidViewMode(value: unknown): value is SpecEditorViewMode {
  return value === 'edit' || value === 'preview' || value === 'review'
}

function isValidPreviewTab(value: unknown): value is SpecEditorPreviewTab {
  return value === 'content' || value === 'implementationPlan'
}

function loadViewModesFromStorage(): ViewModesMap {
  try {
    const saved = sessionStorage.getItem(SPEC_EDITOR_VIEW_MODE_STORAGE_KEY)
    if (!saved) {
      return new Map()
    }

    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      return new Map()
    }

    const entries: Array<[string, SpecEditorViewMode]> = []
    for (const item of parsed) {
      if (Array.isArray(item) && item.length === 2) {
        const [sessionId, mode] = item
        if (typeof sessionId === 'string' && isValidViewMode(mode)) {
          entries.push([sessionId, mode])
        }
      }
    }

    return new Map(entries)
  } catch (error) {
    logger.warn('[specEditorAtoms] Failed to load view modes from storage', error)
    return new Map()
  }
}

function saveViewModesToStorage(viewModes: ViewModesMap): void {
  try {
    const payload = Array.from(viewModes.entries())
    sessionStorage.setItem(SPEC_EDITOR_VIEW_MODE_STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    logger.warn('[specEditorAtoms] Failed to save view modes to storage', error)
  }
}

function loadPreviewTabsFromStorage(): PreviewTabsMap {
  try {
    const saved = sessionStorage.getItem(SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY)
    if (!saved) {
      return new Map()
    }

    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      return new Map()
    }

    const entries: Array<[string, SpecEditorPreviewTab]> = []
    for (const item of parsed) {
      if (Array.isArray(item) && item.length === 2) {
        const [sessionId, tab] = item
        if (typeof sessionId === 'string' && isValidPreviewTab(tab)) {
          entries.push([sessionId, tab])
        }
      }
    }

    return new Map(entries)
  } catch (error) {
    logger.warn('[specEditorAtoms] Failed to load preview tabs from storage', error)
    return new Map()
  }
}

function savePreviewTabsToStorage(previewTabs: PreviewTabsMap): void {
  try {
    const payload = Array.from(previewTabs.entries())
    sessionStorage.setItem(SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    logger.warn('[specEditorAtoms] Failed to save preview tabs to storage', error)
  }
}

const viewModesAtom = atom<ViewModesMap>(loadViewModesFromStorage())
const previewTabsAtom = atom<PreviewTabsMap>(loadPreviewTabsFromStorage())
const contentMapAtom = atom<SpecContentMap>(new Map())
const savedContentMapAtom = atom<SpecContentMap>(new Map())
const dirtySessionsAtom = atom<DirtySessions>([])

const dirtyFlagAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(dirtySessionsAtom).includes(sessionId),
    (get, set, isDirty: boolean) => {
      const current = get(dirtySessionsAtom)
      const next = new Set<string>(current)
      if (isDirty) {
        next.add(sessionId)
      } else {
        next.delete(sessionId)
      }
      set(dirtySessionsAtom, Array.from(next))
    }
  )
)

export const specEditorDirtyAtomFamily = dirtyFlagAtomFamily

export const specEditorDirtySessionsAtom = atom((get) => [...get(dirtySessionsAtom)])

export const specEditorSavedContentAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(savedContentMapAtom).get(sessionId) ?? '',
    (get, set, newContent: string) => {
      const current = get(savedContentMapAtom)
      const next = new Map(current)
      if (newContent === '') {
        next.delete(sessionId)
      } else {
        next.set(sessionId, newContent)
      }
      set(savedContentMapAtom, next)
      set(dirtyFlagAtomFamily(sessionId), false)
    }
  )
)

export const specEditorContentAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(contentMapAtom).get(sessionId) ?? '',
    (get, set, newContent: string) => {
      const current = get(contentMapAtom)
      const next = new Map(current)
      if (newContent === '') {
        next.delete(sessionId)
      } else {
        next.set(sessionId, newContent)
      }
      set(contentMapAtom, next)

      const savedContent = get(specEditorSavedContentAtomFamily(sessionId))
      const isDirty = newContent !== savedContent
      set(dirtyFlagAtomFamily(sessionId), isDirty)
    }
  )
)

export const specEditorViewModeAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(viewModesAtom).get(sessionId) ?? DEFAULT_VIEW_MODE,
    (get, set, newMode: SpecEditorViewMode) => {
      if (!isValidViewMode(newMode)) {
        logger.warn('[specEditorAtoms] Ignoring invalid view mode', newMode)
        return
      }

      const current = get(viewModesAtom)
      const next = new Map(current)
      next.set(sessionId, newMode)
      set(viewModesAtom, next)
      saveViewModesToStorage(next)
    }
  )
)

export const specEditorPreviewTabAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(previewTabsAtom).get(sessionId) ?? DEFAULT_PREVIEW_TAB,
    (get, set, newTab: SpecEditorPreviewTab) => {
      if (!isValidPreviewTab(newTab)) {
        logger.warn('[specEditorAtoms] Ignoring invalid preview tab', newTab)
        return
      }

      const current = get(previewTabsAtom)
      const next = new Map(current)
      next.set(sessionId, newTab)
      set(previewTabsAtom, next)
      savePreviewTabsToStorage(next)
    }
  )
)

export const markSpecEditorSessionSavedAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const latestContent = get(specEditorContentAtomFamily(sessionId))
    set(specEditorSavedContentAtomFamily(sessionId), latestContent)
  }
)
