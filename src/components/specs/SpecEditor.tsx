import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscPlay, VscEye, VscEdit, VscComment, VscChecklist, VscDiscard, VscSend } from 'react-icons/vsc'
import { useImprovePlanAction } from '../../hooks/useImprovePlanAction'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { MarkdownEditor, type MarkdownEditorRef } from './MarkdownEditor'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import { useSpecContent } from '../../hooks/useSpecContent'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useSelection } from '../../hooks/useSelection'
import { useSessions } from '../../hooks/useSessions'
import { useEpics } from '../../hooks/useEpics'
import { theme } from '../../common/theme'
import { Textarea } from '../ui'
import { typography } from '../../common/typography'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from '../../common/i18n'
import {
  markSpecEditorSessionSavedAtom,
  specEditorContentAtomFamily,
  specEditorPreviewTabAtomFamily,
  specEditorSavedContentAtomFamily,
  specEditorViewModeAtomFamily,
} from '../../store/atoms/specEditor'
import { EpicSelect } from '../shared/EpicSelect'
import { SpecReviewEditor } from './SpecReviewEditor'
import { useSpecLineSelection, type SpecLineSelection } from '../../hooks/useSpecLineSelection'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { getActiveAgentTerminalId } from '../../common/terminalTargeting'
import { getPasteSubmissionOptions } from '../../common/terminalPaste'
import { specOrchestratorTerminalId } from '../../common/terminalIdentity'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import { useReviewComments } from '../../hooks/useReviewComments'
import { useSpecReviewCommentStore } from '../../hooks/useSpecReviewCommentStore'
import type { SpecReviewComment } from '../../types/specReview'
import { getTerminalAgentType, getTerminalStartState } from '../../common/terminalStartState'
import { projectPathAtom } from '../../store/atoms/project'

const specText = {
  title: {
    ...typography.headingLarge,
    color: 'var(--color-text-primary)',
    fontWeight: 600,
  },
  badge: {
    ...typography.caption,
    lineHeight: theme.lineHeight.compact,
    color: 'var(--color-text-tertiary)',
  },
  saving: {
    ...typography.caption,
    lineHeight: theme.lineHeight.compact,
    color: 'var(--color-accent-blue-light)',
  },
  toolbarButton: {
    ...typography.button,
    lineHeight: theme.lineHeight.compact,
  },
  toolbarMeta: {
    ...typography.caption,
    color: 'var(--color-text-tertiary)',
  },
  toolbarMetaError: {
    ...typography.caption,
    color: 'var(--color-accent-red-light)',
  },
  stageBadge: {
    ...typography.caption,
    lineHeight: theme.lineHeight.compact,
    fontWeight: 600,
  },
}

interface Props {
  sessionName: string
  allowClarificationControls?: boolean
  disableFocusShortcut?: boolean
  onReviewModeChange?: (isReviewing: boolean) => void
}

export function SpecEditor({
  sessionName,
  allowClarificationControls = false,
  disableFocusShortcut = false,
  onReviewModeChange,
}: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [clarifying, setClarifying] = useState(false)
  const [resettingAgent, setResettingAgent] = useState(false)
  const [clarificationAgentReady, setClarificationAgentReady] = useState(false)
  const [clarificationAgentType, setClarificationAgentType] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [pendingExternalContent, setPendingExternalContent] = useState<string | null>(null)
  const [ignoredExternalContent, setIgnoredExternalContent] = useState<string | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)
  const saveCountRef = useRef(0)
  const latestSavePromiseRef = useRef<Promise<void> | null>(null)
  type TimeoutHandle = ReturnType<typeof setTimeout> | number
  const saveTimeoutRef = useRef<TimeoutHandle | null>(null)
  const shouldFocusAfterModeSwitch = useRef(false)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const projectFileIndex = useProjectFileIndex()

  const { content: cachedContent, displayName: cachedDisplayName, hasData: hasCachedData } = useSpecContent(sessionName)
  const { setSelection } = useSelection()
  const { sessions, updateSessionSpecContent } = useSessions()
  const { setItemEpic } = useEpics()
  const [currentContent, setCurrentContent] = useAtom(specEditorContentAtomFamily(sessionName))
  const [savedContent, setSavedContent] = useAtom(specEditorSavedContentAtomFamily(sessionName))
  const [viewMode, setViewMode] = useAtom(specEditorViewModeAtomFamily(sessionName))
  const [previewTab, setPreviewTab] = useAtom(specEditorPreviewTabAtomFamily(sessionName))
  const markSessionSaved = useSetAtom(markSpecEditorSessionSavedAtom)
  const selectedSession = useMemo(() => sessions.find(session => session.info.session_id === sessionName) ?? null, [sessions, sessionName])
  const selectedEpic = selectedSession?.info.epic ?? null
  const specStage = selectedSession?.info.spec_stage ?? 'draft'
  const isReadyStage = specStage === 'ready'
  const implementationPlan = selectedSession?.info.spec_implementation_plan?.trim() || null
  const hasImplementationPlan = implementationPlan !== null
  const contentTabId = `${sessionName}-content-tab`
  const previewContentPanelId = `${sessionName}-content-panel`
  const implementationPlanTabId = `${sessionName}-implementation-plan-tab`
  const implementationPlanPanelId = `${sessionName}-implementation-plan-panel`
  const improvePlanRoundId = selectedSession?.info.improve_plan_round_id ?? null
  const improvePlanActive = Boolean(improvePlanRoundId)
  const improvePlanAction = useImprovePlanAction({
    logContext: 'SpecEditor',
    onError: (message) => setError(message),
  })
  const improvingPlan = improvePlanAction.startingSessionId === sessionName
  const canImprovePlan = isReadyStage && !improvePlanActive && !improvingPlan

  const [reviewComments, setReviewComments] = useState<SpecReviewComment[]>([])
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentFormPosition, setCommentFormPosition] = useState<{ x: number; y: number } | null>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isDraggingSelectionRef = useRef(false)
  const dragSelectionStartRef = useRef<SpecLineSelection | null>(null)
  const dragStartedInsideSelectionRef = useRef(false)
  const lineSelection = useSpecLineSelection()
  const { getOrchestratorAgentType, getSpecClarificationAgentType } = useClaudeSession()
  const { getConfirmationMessage } = useReviewComments()
  const projectPath = useAtomValue(projectPathAtom)
  const reviewCommentStore = useSpecReviewCommentStore(sessionName, projectPath)
  const [resumeReviewPrompt, setResumeReviewPrompt] = useState<SpecReviewComment[] | null>(null)

  useEffect(() => {
    setError(null)
    setPendingExternalContent(null)
    setIgnoredExternalContent(null)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [sessionName])

  useEffect(() => {
    if (!hasImplementationPlan && previewTab !== 'content') {
      setPreviewTab('content')
    }
  }, [hasImplementationPlan, previewTab, setPreviewTab])

  const applyServerContent = useCallback((serverContent: string) => {
    setCurrentContent(serverContent)
    setSavedContent(serverContent)
    setPendingExternalContent(null)
    setIgnoredExternalContent(null)
  }, [setCurrentContent, setSavedContent])

  useEffect(() => {
    if (!sessionName || hasCachedData) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const projectScope = projectPath ? { projectPath } : {}
        const [draftContent, initialPrompt] = await invoke<[string | null, string | null]>(
          TauriCommands.SchaltwerkCoreGetSessionAgentContent,
          { name: sessionName, ...projectScope }
        )

        if (cancelled) return

        const text = draftContent ?? initialPrompt ?? ''
        applyServerContent(text)
        setDisplayName(sessionName)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        logger.error('[SpecEditor] Failed to load spec content:', e)
        setError(String(e))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyServerContent, hasCachedData, projectPath, sessionName])

  useEffect(() => {
    if (hasCachedData) {
      setLoading(false)
      setDisplayName(cachedDisplayName ?? sessionName)
    }
  }, [cachedDisplayName, hasCachedData, sessionName])

  useEffect(() => {
    if (!hasCachedData) return

    if (saveCountRef.current > 0) {
      logger.info('[SpecEditor] Skipping update - save in progress')
      return
    }

    const serverContent = cachedContent ?? ''
    const hasLocalEdits = currentContent !== savedContent
    const serverChanged = serverContent !== savedContent

    if (!serverChanged) {
      if (!hasLocalEdits && ignoredExternalContent !== null) {
        setIgnoredExternalContent(null)
      }
      if (pendingExternalContent === serverContent) {
        setPendingExternalContent(null)
      }
      return
    }

    if (hasLocalEdits) {
      if (ignoredExternalContent === serverContent) {
        return
      }

      logger.info('[SpecEditor] Deferring external update while local edits are dirty')
      setPendingExternalContent(previous => previous === serverContent ? previous : serverContent)
      return
    }

    logger.info('[SpecEditor] Updating content from server')
    applyServerContent(serverContent)
  }, [
    applyServerContent,
    cachedContent,
    currentContent,
    hasCachedData,
    ignoredExternalContent,
    pendingExternalContent,
    savedContent,
  ])

  const ensureProjectFiles = projectFileIndex.ensureIndex

  useEffect(() => {
    void ensureProjectFiles()
  }, [ensureProjectFiles])

  useEffect(() => {
    if (viewMode === 'edit' && shouldFocusAfterModeSwitch.current) {
      shouldFocusAfterModeSwitch.current = false
      if (markdownEditorRef.current) {
        markdownEditorRef.current.focusEnd()
        logger.info('[SpecEditor] Focused spec content after mode switch')
      }
    }
  }, [viewMode])

  useEffect(() => {
    if (showCommentForm) {
      requestAnimationFrame(() => {
        commentTextareaRef.current?.focus()
      })
    }
  }, [showCommentForm])

  const trackSavePromise = useCallback((savePromise: Promise<void>) => {
    latestSavePromiseRef.current = savePromise
    void savePromise.finally(() => {
      if (latestSavePromiseRef.current === savePromise) {
        latestSavePromiseRef.current = null
      }
    })
    return savePromise
  }, [])

  const persistSpecContent = useCallback(async (content: string) => {
    saveCountRef.current++
    setSaving(true)
    try {
      await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, {
        name: sessionName,
        content,
      })
      setSavedContent(content)
      logger.info('[SpecEditor] Spec saved automatically')
      updateSessionSpecContent(sessionName, content)
    } catch (e) {
      logger.error('[SpecEditor] Failed to save spec:', e)
      setError(String(e))
      throw e
    } finally {
      saveCountRef.current--
      if (saveCountRef.current === 0) {
        setSaving(false)
        markSessionSaved(sessionName)
      }
    }
  }, [markSessionSaved, sessionName, setSavedContent, updateSessionSpecContent])

  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    if (latestSavePromiseRef.current) {
      await latestSavePromiseRef.current
    }

    if (currentContent !== savedContent) {
      await trackSavePromise(persistSpecContent(currentContent))
    }
  }, [currentContent, persistSpecContent, savedContent, trackSavePromise])

  const handleContentChange = (newContent: string) => {
    setCurrentContent(newContent)

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    setSaving(true)
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      void trackSavePromise(persistSpecContent(newContent))
    }, 400)
  }

  const handleCopy = useCallback(async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(currentContent)
    } catch (err) {
      logger.error('[SpecEditor] Failed to copy content:', err)
    } finally {
      window.setTimeout(() => setCopying(false), 1000)
    }
  }, [currentContent])

  const handleReloadExternalContent = useCallback(() => {
    if (pendingExternalContent === null) return
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      setSaving(false)
    }
    applyServerContent(pendingExternalContent)
  }, [applyServerContent, pendingExternalContent])

  const handleKeepLocalEdits = useCallback(() => {
    if (pendingExternalContent === null) return
    setIgnoredExternalContent(pendingExternalContent)
    setPendingExternalContent(null)
  }, [pendingExternalContent])

  const specTerminalId = useMemo(() => {
    const stableSpecId = selectedSession?.info.stable_id ?? sessionName
    return specOrchestratorTerminalId(stableSpecId)
  }, [selectedSession?.info.stable_id, sessionName])

  useEffect(() => {
    if (!allowClarificationControls) {
      setClarificationAgentReady(false)
      setClarificationAgentType(null)
      return
    }

    setClarificationAgentReady(getTerminalStartState(specTerminalId) === 'started')
    setClarificationAgentType(getTerminalAgentType(specTerminalId))

    return listenUiEvent(UiEvent.AgentLifecycle, detail => {
      if (!detail || detail.terminalId !== specTerminalId) return

      if (detail.agentType) {
        setClarificationAgentType(detail.agentType)
      }

      if (detail.state === 'ready') {
        setClarificationAgentReady(true)
        return
      }

      if (detail.state === 'spawned' || detail.state === 'failed') {
        setClarificationAgentReady(false)
      }
    })
  }, [allowClarificationControls, specTerminalId])

  const canClarify = allowClarificationControls && clarificationAgentReady && !clarifying && !resettingAgent
  const canRunSpec = allowClarificationControls && !clarifying && !resettingAgent

  const handleClarify = useCallback(async () => {
    if (!canClarify) return

    try {
      setClarifying(true)
      setError(null)
      await flushPendingSave()
      await invoke(TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt, {
        terminalId: specTerminalId,
        specName: sessionName,
        ...(clarificationAgentType ? { agentType: clarificationAgentType } : {}),
      })
      emitUiEvent(UiEvent.SpecClarificationActivity, {
        sessionName,
        terminalId: specTerminalId,
        source: 'user-submit',
      })
    } catch (e: unknown) {
      logger.error('[SpecEditor] Failed to submit spec clarification prompt:', e)
      setError(String(e))
    } finally {
      setClarifying(false)
    }
  }, [canClarify, clarificationAgentType, flushPendingSave, sessionName, specTerminalId])

  const handleImprovePlan = useCallback(async () => {
    if (!canImprovePlan) return
    setError(null)
    await flushPendingSave()
    await improvePlanAction.start(sessionName)
  }, [canImprovePlan, flushPendingSave, improvePlanAction, sessionName])

  const handleRunSpec = useCallback(async () => {
    if (!canRunSpec) return

    try {
      setError(null)
      await flushPendingSave()
      emitUiEvent(UiEvent.StartAgentFromSpec, { name: sessionName })
    } catch (e: unknown) {
      logger.error('[SpecEditor] Failed to open start-from-spec flow:', e)
      setError(String(e))
    }
  }, [canRunSpec, flushPendingSave, sessionName])

  const handleResetClarificationAgent = useCallback(async () => {
    if (!allowClarificationControls || clarifying || resettingAgent) return

    const previousReady = clarificationAgentReady
    const previousAgentType = clarificationAgentType
    try {
      setResettingAgent(true)
      setClarificationAgentReady(false)
      setError(null)
      const nextAgentType = await getSpecClarificationAgentType()
      await invoke(TauriCommands.SchaltwerkCoreResetSpecOrchestrator, {
        terminalId: specTerminalId,
        specName: sessionName,
        ...(nextAgentType ? { agentType: nextAgentType } : {}),
      })
      setClarificationAgentType(nextAgentType)
      setClarificationAgentReady(true)
      emitUiEvent(UiEvent.TerminalReset, { kind: 'session', sessionId: sessionName })
    } catch (e: unknown) {
      logger.error('[SpecEditor] Failed to reset spec clarification agent:', e)
      setClarificationAgentReady(previousReady)
      setClarificationAgentType(previousAgentType)
      setError(String(e))
    } finally {
      setResettingAgent(false)
    }
  }, [
    allowClarificationControls,
    clarificationAgentReady,
    clarificationAgentType,
    clarifying,
    getSpecClarificationAgentType,
    resettingAgent,
    sessionName,
    specTerminalId,
  ])

  const handleSetStage = useCallback(async (stage: 'draft' | 'ready') => {
    try {
      setError(null)
      await invoke(TauriCommands.SchaltwerkCoreSetSpecStage, { name: sessionName, stage })
    } catch (e) {
      logger.error('[SpecEditor] Failed to update spec stage', e)
      setError(String(e))
    }
  }, [sessionName])

  const handleEnterReviewMode = useCallback(async () => {
    lineSelection.clearSelection()
    isDraggingSelectionRef.current = false
    dragSelectionStartRef.current = null
    dragStartedInsideSelectionRef.current = false
    setShowCommentForm(false)

    let stored: SpecReviewComment[] = []
    try {
      stored = await reviewCommentStore.load()
    } catch (e) {
      logger.error('[SpecEditor] Failed to load stored review comments:', e)
    }

    if (stored.length > 0) {
      setResumeReviewPrompt(stored)
      return
    }

    setReviewComments([])
    setViewMode('review')
    onReviewModeChange?.(true)
    logger.info('[SpecEditor] Entered review mode (no stored draft)')
  }, [lineSelection, onReviewModeChange, reviewCommentStore, setViewMode])

  const handleResumeReviewContinue = useCallback(() => {
    const stored = resumeReviewPrompt ?? []
    setReviewComments(stored)
    setResumeReviewPrompt(null)
    setViewMode('review')
    onReviewModeChange?.(true)
    logger.info('[SpecEditor] Entered review mode (continued draft)', { count: stored.length })
  }, [onReviewModeChange, resumeReviewPrompt, setViewMode])

  const handleResumeReviewClear = useCallback(async () => {
    try {
      await reviewCommentStore.clear()
    } catch (e) {
      logger.error('[SpecEditor] Failed to clear stored review comments:', e)
    }
    setReviewComments([])
    setResumeReviewPrompt(null)
    setViewMode('review')
    onReviewModeChange?.(true)
    logger.info('[SpecEditor] Entered review mode (cleared stored draft)')
  }, [onReviewModeChange, reviewCommentStore, setViewMode])

  const handleExitReviewMode = useCallback(() => {
    setReviewComments([])
    lineSelection.clearSelection()
    isDraggingSelectionRef.current = false
    dragSelectionStartRef.current = null
    dragStartedInsideSelectionRef.current = false
    setShowCommentForm(false)
    setViewMode('preview')
    onReviewModeChange?.(false)
    logger.info('[SpecEditor] Exited review mode')
  }, [lineSelection, setViewMode, onReviewModeChange])

  const handleLineClick = useCallback((lineNum: number, specId: string, event?: React.MouseEvent) => {
    const selectionAtDragStart = lineSelection.getSelection()
    dragSelectionStartRef.current = selectionAtDragStart
    dragStartedInsideSelectionRef.current = Boolean(
      selectionAtDragStart &&
      selectionAtDragStart.specId === specId &&
      lineNum >= selectionAtDragStart.startLine &&
      lineNum <= selectionAtDragStart.endLine
    )
    isDraggingSelectionRef.current = true
    lineSelection.handleLineClick(lineNum, specId, event)
  }, [lineSelection])

  const handleLineMouseEnter = useCallback((lineNum: number) => {
    if (!isDraggingSelectionRef.current) {
      return
    }

    if (!lineSelection.getSelection() && dragStartedInsideSelectionRef.current && dragSelectionStartRef.current) {
      lineSelection.setSelectionDirect(dragSelectionStartRef.current)
    }

    if (lineSelection.getSelection()) {
      lineSelection.extendSelection(lineNum, sessionName)
    }
  }, [lineSelection, sessionName])

  const handleLineMouseUp = useCallback((event: MouseEvent) => {
    isDraggingSelectionRef.current = false
    const currentSelection = lineSelection.getSelection()

    if (currentSelection) {
      setCommentFormPosition({ x: event.clientX, y: event.clientY })
      setShowCommentForm(true)
    }

    dragSelectionStartRef.current = null
    dragStartedInsideSelectionRef.current = false
  }, [lineSelection])

  const handleSubmitComment = useCallback(() => {
    if (!lineSelection.selection || !commentText.trim()) return

    const contentLines = currentContent.split('\n')
    const selectedText = contentLines
      .slice(lineSelection.selection.startLine - 1, lineSelection.selection.endLine)
      .join('\n')

    const newComment: SpecReviewComment = {
      id: crypto.randomUUID(),
      specId: sessionName,
      lineRange: {
        start: lineSelection.selection.startLine,
        end: lineSelection.selection.endLine,
      },
      selectedText,
      comment: commentText.trim(),
      timestamp: Date.now(),
    }

    const nextComments = [...reviewComments, newComment]
    setReviewComments(nextComments)
    void reviewCommentStore.save(nextComments).catch(e =>
      logger.error('[SpecEditor] Failed to persist review comments:', e),
    )
    lineSelection.clearSelection()
    isDraggingSelectionRef.current = false
    dragSelectionStartRef.current = null
    dragStartedInsideSelectionRef.current = false
    setShowCommentForm(false)
    setCommentFormPosition(null)
    setCommentText('')
    logger.info('[SpecEditor] Added review comment', { lineRange: newComment.lineRange })
  }, [lineSelection, currentContent, sessionName, commentText, reviewCommentStore, reviewComments])

  
  const handleCancelComment = useCallback(() => {
    lineSelection.clearSelection()
    isDraggingSelectionRef.current = false
    dragSelectionStartRef.current = null
    dragStartedInsideSelectionRef.current = false
    setShowCommentForm(false)
    setCommentFormPosition(null)
    setCommentText('')
  }, [lineSelection])

  const formatSpecReviewForPrompt = useCallback((comments: SpecReviewComment[], specName: string, specDisplayName: string | null): string => {
    let output = '\n# Spec Review Comments\n\n'
    output += `## ${specDisplayName || specName}\n\n`

    for (const comment of comments) {
      const lineText = comment.lineRange.start === comment.lineRange.end
        ? `Line ${comment.lineRange.start}`
        : `Lines ${comment.lineRange.start}-${comment.lineRange.end}`
      output += `### ${lineText}:\n`
      output += `\`\`\`\n${comment.selectedText}\n\`\`\`\n`
      output += `**Comment:** ${comment.comment}\n\n`
    }

    return output
  }, [])

  const handleFinishReview = useCallback(async () => {
    if (reviewComments.length === 0) return

    const reviewText = formatSpecReviewForPrompt(reviewComments, sessionName, displayName)

    let agentType: string | undefined = selectedSession?.info.original_agent_type
    if (!agentType) {
      try {
        agentType = await getOrchestratorAgentType()
      } catch (err) {
        logger.error('[SpecEditor] Failed to get fallback agent type for spec review', err)
      }
    }

    const { useBracketedPaste, needsDelayedSubmit } = getPasteSubmissionOptions(agentType)
    const stableSpecId = selectedSession?.info.stable_id ?? sessionName
    const terminalId = getActiveAgentTerminalId(sessionName) ?? specOrchestratorTerminalId(stableSpecId)

    try {
      await invoke(TauriCommands.PasteAndSubmitTerminal, {
        id: terminalId,
        data: reviewText,
        useBracketedPaste,
        needsDelayedSubmit,
      })
      emitUiEvent(UiEvent.SpecClarificationActivity, {
        sessionName,
        terminalId,
        source: 'user-submit',
      })

      void setSelection({ kind: 'session', payload: sessionName, sessionState: 'spec' }, false, true)
      handleExitReviewMode()
      logger.info('[SpecEditor] Finished review, pasted to spec clarification agent', { terminalId, sessionName })
    } catch (err) {
      logger.error('[SpecEditor] Failed to paste review to terminal', err)
      setError('Failed to send review to clarification agent')
    }
  }, [reviewComments, formatSpecReviewForPrompt, sessionName, displayName, selectedSession, getOrchestratorAgentType, setSelection, handleExitReviewMode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode === 'review' && e.key === 'Escape') {
        e.preventDefault()
        if (showCommentForm) {
          handleCancelComment()
        } else {
          handleExitReviewMode()
        }
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.SubmitDiffComment, keyboardShortcutConfig, { platform })) {
        if (viewMode === 'review' && reviewComments.length > 0 && !showCommentForm) {
          e.preventDefault()
          e.stopPropagation()
          void handleFinishReview()
          return
        }
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.RunSpecAgent, keyboardShortcutConfig, { platform })) {
        if (viewMode === 'review' && reviewComments.length > 0 && !showCommentForm) {
          e.preventDefault()
          e.stopPropagation()
          void handleFinishReview()
          return
        }
        if (viewMode !== 'review' && canRunSpec) {
          e.preventDefault()
          void handleRunSpec()
          return
        }
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.RefineSpec, keyboardShortcutConfig, { platform })) {
        if (viewMode !== 'review' && canClarify) {
          e.preventDefault()
          void handleClarify()
          return
        }
      }

      if (!disableFocusShortcut && isShortcutForAction(e, KeyboardShortcutAction.FocusClaude, keyboardShortcutConfig, { platform })) {
        e.preventDefault()

        if (viewMode === 'preview' || viewMode === 'review') {
          shouldFocusAfterModeSwitch.current = true
          setViewMode('edit')
          logger.info('[SpecEditor] Switched to edit mode via shortcut')
        } else if (markdownEditorRef.current) {
          markdownEditorRef.current.focusEnd()
          logger.info('[SpecEditor] Focused spec content via shortcut')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canClarify, canRunSpec, handleClarify, handleRunSpec, handleFinishReview, reviewComments.length, keyboardShortcutConfig, platform, disableFocusShortcut, viewMode, sessionName, setViewMode, showCommentForm, handleCancelComment, handleExitReviewMode])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="truncate" style={specText.title}>{displayName || sessionName}</h2>
          <EpicSelect
            value={selectedEpic}
            onChange={(epicId) => setItemEpic(sessionName, epicId)}
            showDeleteButton
          />
          {!disableFocusShortcut && (
            <span
              className="px-1.5 py-0.5 rounded bg-bg-hover/50"
              style={specText.badge}
              title={viewMode === 'edit' ? t.specEditor.focusSpecContent : t.specEditor.editSpecContent}
            >
              ⌘T
            </span>
          )}
          {saving && (
            <span
              className="px-1.5 py-0.5 rounded"
              style={{
                ...specText.saving,
                backgroundColor: 'var(--color-accent-blue-bg)',
              }}
              title={t.specEditor.saving}
            >
              💾
            </span>
          )}
          <span
            className="px-1.5 py-0.5 rounded border"
            style={{
              ...specText.stageBadge,
              color: isReadyStage ? 'var(--color-accent-green-light)' : 'var(--color-accent-yellow-light)',
              backgroundColor: isReadyStage ? 'var(--color-accent-green-bg)' : 'var(--color-accent-yellow-bg)',
              borderColor: isReadyStage ? 'var(--color-accent-green-border)' : 'var(--color-accent-yellow-border)',
            }}
          >
            {specStage}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode !== 'review' ? (
            <>
              <button
                onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
                className="px-2 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1"
                style={specText.toolbarButton}
                title={viewMode === 'edit' ? t.specEditor.previewMarkdown : t.specEditor.editMarkdown}
              >
                {viewMode === 'edit' ? <VscEye /> : <VscEdit />}
                {viewMode === 'edit' ? t.specEditor.preview : t.specEditor.edit}
              </button>
              <button
                onClick={() => { void handleEnterReviewMode() }}
                className="px-2 py-1 rounded flex items-center gap-1 hover:opacity-90"
                style={{
                  ...specText.toolbarButton,
                  backgroundColor: 'var(--color-accent-purple-bg)',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'var(--color-accent-purple-border)',
                  color: 'var(--color-accent-purple)'
                }}
                title={t.specEditor.addComments}
              >
                <VscComment />
                {t.specEditor.comment}
              </button>
              {isReadyStage ? (
                <button
                  onClick={() => { void handleSetStage('draft') }}
                  className="px-2 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1"
                  style={specText.toolbarButton}
                  title={t.specEditor.moveToDraft}
                >
                  {t.specEditor.moveToDraft}
                </button>
              ) : (
                <button
                  onClick={() => { void handleSetStage('ready') }}
                  className="px-2 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1"
                  style={specText.toolbarButton}
                  title={t.specEditor.markClarified}
                >
                  {t.specEditor.markClarified}
                </button>
              )}
              {allowClarificationControls && (
                <button
                  onClick={() => { void handleResetClarificationAgent() }}
                  disabled={clarifying || resettingAgent}
                  className="px-2 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={specText.toolbarButton}
                  title={t.specEditor.resetClarificationAgent}
                >
                  <VscDiscard />
                  {t.specEditor.resetClarificationAgent}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={handleExitReviewMode}
              className="px-2 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1"
              style={specText.toolbarButton}
              title={t.specEditor.exitReviewMode}
            >
              <VscEdit />
              {t.specEditor.exitReview}
            </button>
          )}
          {allowClarificationControls && (
            <>
              <button
                onClick={() => { void handleClarify() }}
                disabled={!canClarify}
                className="px-3 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                style={specText.toolbarButton}
                title={t.specEditor.refine}
              >
                <VscComment />
                {clarifying ? (
                  <AnimatedText text="loading" size="xs" />
                ) : (
                  t.specEditor.refine
                )}
              </button>
              {(isReadyStage || improvePlanActive) && (
                <button
                  onClick={() => { void handleImprovePlan() }}
                  disabled={!canImprovePlan}
                  aria-label={t.specEditor.improvePlan}
                  className="px-3 py-1 rounded bg-bg-hover hover:bg-bg-hover text-text-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={specText.toolbarButton}
                  title={
                    improvePlanActive
                      ? t.specEditor.improvePlanActive
                      : t.specEditor.improvePlanTooltip
                  }
                >
                  <VscChecklist />
                  {improvingPlan ? (
                    <AnimatedText text={t.specEditor.improvingPlan} size="xs" />
                  ) : (
                    t.specEditor.improvePlan
                  )}
                </button>
              )}
              <button
                onClick={() => { void handleRunSpec() }}
                disabled={!canRunSpec}
                className="px-3 py-1 rounded bg-accent-green hover:bg-[var(--color-accent-green-light)] text-text-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                style={specText.toolbarButton}
                title={t.specEditor.run}
              >
                <VscPlay />
                {t.specEditor.run}
              </button>
            </>
          )}
          <button
            onClick={() => { void handleCopy() }}
            disabled={copying || !currentContent}
            className="px-2 py-1 rounded flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            style={{ ...specText.toolbarButton, backgroundColor: 'var(--color-accent-blue)', color: 'var(--color-text-inverse)' }}
            title={t.specEditor.copyContent}
          >
            <VscCopy />
            {copying ? t.specEditor.copied : t.specEditor.copy}
          </button>
        </div>
      </div>

      <div className="px-4 py-1 border-b border-border-subtle flex items-center justify-between">
        <div style={specText.toolbarMeta}>
          {error ? (
            <span style={specText.toolbarMetaError}>{error}</span>
          ) : viewMode === 'edit' ? (
            t.specEditor.editingSpec
          ) : viewMode === 'review' ? (
            t.specEditor.reviewMode
          ) : (
            t.specEditor.previewMode
          )}
        </div>
      </div>

      {pendingExternalContent !== null && (
        <div
          data-testid="spec-external-update-banner"
          className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-3"
          style={{
            backgroundColor: 'var(--color-accent-yellow-bg)',
            borderColor: 'var(--color-accent-yellow-border)',
          }}
        >
          <div className="min-w-0">
            <div
              style={{
                ...typography.body,
                color: 'var(--color-text-primary)',
                fontWeight: 600,
              }}
            >
              {t.specEditor.externalUpdateTitle}
            </div>
            <div
              style={{
                ...typography.caption,
                color: 'var(--color-text-secondary)',
              }}
            >
              {t.specEditor.externalUpdateMessage}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="spec-external-update-keep"
              onClick={handleKeepLocalEdits}
              className="px-3 py-1.5 rounded border border-border-default text-text-secondary hover:bg-bg-hover"
              style={{ fontSize: theme.fontSize.body }}
            >
              {t.specEditor.keepLocalEdits}
            </button>
            <button
              type="button"
              data-testid="spec-external-update-reload"
              onClick={handleReloadExternalContent}
              className="px-3 py-1.5 rounded font-medium hover:opacity-90"
              style={{
                fontSize: theme.fontSize.body,
                backgroundColor: 'var(--color-accent-yellow)',
                color: 'var(--color-accent-amber-text)',
              }}
            >
              {t.specEditor.reloadBackendVersion}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        <div style={{ display: viewMode === 'edit' ? 'block' : 'none' }} className="h-full">
          <MarkdownEditor
            ref={markdownEditorRef}
            value={currentContent}
            onChange={handleContentChange}
            placeholder={t.specEditor.enterAgentDescription}
            className="h-full"
            fileReferenceProvider={projectFileIndex}
            ariaLabel={t.specEditor.specAriaLabel}
          />
        </div>
        <div style={{ display: viewMode === 'preview' ? 'block' : 'none' }} className="h-full">
          {hasImplementationPlan ? (
            <div className="h-full flex flex-col">
              <div
                role="tablist"
                aria-label={t.specEditor.previewMode}
                data-testid="spec-preview-tabs"
                className="px-4 pt-3 border-b border-border-subtle flex items-center gap-2"
              >
                <button
                  type="button"
                  role="tab"
                  id={contentTabId}
                  aria-selected={previewTab === 'content'}
                  aria-controls={previewContentPanelId}
                  onClick={() => setPreviewTab('content')}
                  title={t.specEditor.previewSpecTabTooltip}
                  data-testid="spec-preview-tab-content"
                  className="px-3 py-1.5 rounded border transition-colors"
                  style={{
                    ...typography.button,
                    borderColor: previewTab === 'content'
                      ? 'var(--color-border-default)'
                      : 'var(--color-border-subtle)',
                    backgroundColor: previewTab === 'content'
                      ? 'var(--color-bg-elevated)'
                      : 'transparent',
                    color: previewTab === 'content'
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  {t.specEditor.previewSpecTabLabel}
                </button>
                <button
                  type="button"
                  role="tab"
                  id={implementationPlanTabId}
                  aria-selected={previewTab === 'implementationPlan'}
                  aria-controls={implementationPlanPanelId}
                  onClick={() => setPreviewTab('implementationPlan')}
                  title={t.specEditor.previewPlanTabTooltip}
                  data-testid="spec-preview-tab-plan"
                  className="px-3 py-1.5 rounded border transition-colors"
                  style={{
                    ...typography.button,
                    borderColor: previewTab === 'implementationPlan'
                      ? 'var(--color-border-default)'
                      : 'var(--color-border-subtle)',
                    backgroundColor: previewTab === 'implementationPlan'
                      ? 'var(--color-bg-elevated)'
                      : 'transparent',
                    color: previewTab === 'implementationPlan'
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  {t.specEditor.implementationPlanHeading}
                </button>
              </div>
              <div
                id={previewContentPanelId}
                role="tabpanel"
                aria-labelledby={contentTabId}
                hidden={previewTab !== 'content'}
                className="flex-1 min-h-0 overflow-auto"
              >
                <MarkdownRenderer content={currentContent} fillHeight={false} />
              </div>
              <div
                id={implementationPlanPanelId}
                role="tabpanel"
                aria-labelledby={implementationPlanTabId}
                hidden={previewTab !== 'implementationPlan'}
                className="flex-1 min-h-0 overflow-auto"
              >
                <MarkdownRenderer content={implementationPlan} fillHeight={false} />
              </div>
            </div>
          ) : (
            <MarkdownRenderer content={currentContent} className="h-full" />
          )}
        </div>
        <div style={{ display: viewMode === 'review' ? 'flex' : 'none', flexDirection: 'column' }} className="h-full relative">
          <div className="flex-1 min-h-0 overflow-auto">
            <SpecReviewEditor
              content={currentContent}
              specId={sessionName}
              selection={lineSelection.selection}
              onLineClick={handleLineClick}
              onLineMouseEnter={handleLineMouseEnter}
              onLineMouseUp={handleLineMouseUp}
            />
          </div>
          {showCommentForm && lineSelection.selection && (
            <>
              <div
                className="fixed inset-0 z-[59]"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCancelComment()
                }}
              />
              <div
                className="fixed right-4 bg-bg-secondary border border-border-default rounded-lg shadow-xl p-4 w-96 z-[60]"
                style={{
                  top: commentFormPosition
                    ? Math.min(commentFormPosition.y, window.innerHeight - 300)
                    : '50%',
                  transform: commentFormPosition ? 'none' : 'translateY(-50%)',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <div className="font-medium mb-1" style={{ fontSize: theme.fontSize.body }}>{t.specEditor.addReviewComment}</div>
                  <div style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
                    {lineSelection.selection.startLine === lineSelection.selection.endLine
                      ? t.specEditor.line.replace('{line}', String(lineSelection.selection.startLine))
                      : t.specEditor.lines
                          .replace('{start}', String(lineSelection.selection.startLine))
                          .replace('{end}', String(lineSelection.selection.endLine))}
                  </div>
                </div>
                <Textarea
                  ref={commentTextareaRef}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={t.specEditor.writeComment}
                  className="w-full"
                  resize="none"
                  rows={4}
                  onKeyDown={(e) => {
                    const nativeEvent = e.nativeEvent as KeyboardEvent
                    if (isShortcutForAction(
                      nativeEvent,
                      KeyboardShortcutAction.SubmitDiffComment,
                      keyboardShortcutConfig,
                      { platform }
                    )) {
                      e.preventDefault()
                      e.stopPropagation()
                      handleSubmitComment()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      handleCancelComment()
                    }
                  }}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={handleCancelComment}
                    className="px-3 py-1.5 bg-bg-elevated hover:bg-bg-hover rounded"
                    style={{ fontSize: theme.fontSize.body }}
                  >
                    {t.specEditor.cancel}
                  </button>
                  <button
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim()}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-medium flex items-center gap-2"
                    style={{ fontSize: theme.fontSize.body }}
                  >
                    <VscSend />
                    {t.specEditor.submit}
                  </button>
                </div>
              </div>
            </>
          )}
          {reviewComments.length > 0 && (
            <div
              className="px-3 py-2 border-t border-border-subtle bg-bg-primary flex items-center justify-between gap-3 shrink-0"
              style={{ fontSize: theme.fontSize.caption }}
            >
              <span style={{ color: 'var(--color-text-muted)' }}>
                {getConfirmationMessage(reviewComments.length)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExitReviewMode}
                  className="px-2 py-1 border border-border-default text-text-secondary rounded hover:bg-bg-elevated transition-colors"
                  style={{ fontSize: theme.fontSize.caption }}
                  title={t.specEditor.discardPendingComments}
                >
                  {t.specEditor.cancelReview}
                </button>
                <button
                  onClick={() => { void handleFinishReview() }}
                  className="px-2 py-1 rounded font-medium transition-colors hover:opacity-90"
                  style={{ fontSize: theme.fontSize.caption, backgroundColor: 'var(--color-accent-cyan)', color: 'var(--color-text-inverse)' }}
                  title={t.specEditor.sendReviewComments}
                >
                  {t.specEditor.finishReview.replace('{count}', String(reviewComments.length))}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {resumeReviewPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div
            className="bg-bg-secondary border border-border-default rounded-lg shadow-xl p-5 w-[420px]"
            role="dialog"
            aria-label={t.specEditor.resumeReviewTitle}
          >
            <div
              className="font-medium mb-2"
              style={{ fontSize: theme.fontSize.bodyLarge, color: 'var(--color-text-primary)' }}
            >
              {t.specEditor.resumeReviewTitle}
            </div>
            <div
              className="mb-4"
              style={{ fontSize: theme.fontSize.body, color: 'var(--color-text-secondary)' }}
            >
              {t.specEditor.resumeReviewMessage
                .replace('{count}', String(resumeReviewPrompt.length))
                .replace('{plural}', resumeReviewPrompt.length === 1 ? '' : 's')}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { void handleResumeReviewClear() }}
                className="px-3 py-1.5 rounded border border-border-default text-text-secondary hover:bg-bg-hover"
                style={{ fontSize: theme.fontSize.body }}
              >
                {t.specEditor.resumeReviewClear}
              </button>
              <button
                onClick={handleResumeReviewContinue}
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-medium"
                style={{ fontSize: theme.fontSize.body }}
              >
                {t.specEditor.resumeReviewContinue}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
