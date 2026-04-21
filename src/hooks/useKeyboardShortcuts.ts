import { useContext, useEffect } from 'react'
import {
  KeyboardShortcutAction,
  KeyboardShortcutConfig,
  defaultShortcutConfig,
} from '../keyboardShortcuts/config'
import { KeyboardShortcutContext } from '../contexts/KeyboardShortcutsContext'
import { detectPlatformSafe, isShortcutForAction } from '../keyboardShortcuts/helpers'
import type { Platform } from '../keyboardShortcuts/matcher'

interface KeyboardShortcutsProps {
  onSelectOrchestrator: () => void
  onSelectSession: (index: number) => void
  onCancelSelectedSession?: (immediate: boolean) => void
  onRefineSpec?: () => void
  onSpecSession?: () => void
  onPromoteSelectedVersion?: () => void
  sessionCount: number
  projectCount?: number
  onSelectPrevSession?: () => void
  onSelectNextSession?: () => void
  onFocusSidebar?: () => void
  onFocusClaude?: () => void
  onOpenDiffViewer?: () => void
  onFocusTerminal?: () => void
  isDiffViewerOpen?: boolean
  isModalOpen?: boolean
  onResetSelection?: () => void
  onOpenSwitchModel?: () => void
  onOpenMergeModal?: () => void
  onUpdateSessionFromParent?: () => void
  onCreatePullRequest?: () => void
  onOpenInApp?: () => void
  onOpenSettings?: () => void
  onSwitchToProject?: (index: number) => void
  onCycleNextProject?: () => void
  onCyclePrevProject?: () => void
}

interface KeyboardShortcutOptions {
  shortcutConfig?: KeyboardShortcutConfig
  platform?: Platform
}

export function useKeyboardShortcuts(
  {
    onSelectOrchestrator,
    onSelectSession,
    onCancelSelectedSession,
    onRefineSpec,
    onSpecSession,
    onPromoteSelectedVersion,
    sessionCount,
    projectCount,
    onSelectPrevSession,
    onSelectNextSession,
    onFocusClaude,
    onOpenDiffViewer,
    onFocusTerminal,
    isDiffViewerOpen,
    isModalOpen,
    onResetSelection,
    onOpenSwitchModel,
    onOpenMergeModal,
    onUpdateSessionFromParent,
    onCreatePullRequest,
    onOpenInApp,
    onOpenSettings,
    onSwitchToProject,
    onCycleNextProject,
    onCyclePrevProject,
  }: KeyboardShortcutsProps,
  options: KeyboardShortcutOptions = {},
) {
  const context = useContext(KeyboardShortcutContext)
  const shortcutConfig = options.shortcutConfig ?? context?.config ?? defaultShortcutConfig
  const platform = options.platform ?? detectPlatformSafe()

  useEffect(() => {
    const sessionActions: KeyboardShortcutAction[] = [
      KeyboardShortcutAction.SwitchToSession1,
      KeyboardShortcutAction.SwitchToSession2,
      KeyboardShortcutAction.SwitchToSession3,
      KeyboardShortcutAction.SwitchToSession4,
      KeyboardShortcutAction.SwitchToSession5,
      KeyboardShortcutAction.SwitchToSession6,
      KeyboardShortcutAction.SwitchToSession7,
      KeyboardShortcutAction.SwitchToSession8,
    ]

    const projectActions: KeyboardShortcutAction[] = [
      KeyboardShortcutAction.SwitchToProject1,
      KeyboardShortcutAction.SwitchToProject2,
      KeyboardShortcutAction.SwitchToProject3,
      KeyboardShortcutAction.SwitchToProject4,
      KeyboardShortcutAction.SwitchToProject5,
      KeyboardShortcutAction.SwitchToProject6,
      KeyboardShortcutAction.SwitchToProject7,
      KeyboardShortcutAction.SwitchToProject8,
      KeyboardShortcutAction.SwitchToProject9,
    ]

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen) {
        return
      }

      if (isShortcutForAction(event, KeyboardShortcutAction.SwitchToOrchestrator, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectOrchestrator()
        return
      }

      for (let index = 0; index < sessionActions.length; index++) {
        if (index >= sessionCount) break
        if (isShortcutForAction(event, sessionActions[index], shortcutConfig, { platform })) {
          event.preventDefault()
          onSelectSession(index)
          return
        }
      }

      if (onSwitchToProject) {
        for (let index = 0; index < projectActions.length; index++) {
          if (projectCount !== undefined && index >= projectCount) break
          if (isShortcutForAction(event, projectActions[index], shortcutConfig, { platform })) {
            event.preventDefault()
            onSwitchToProject(index)
            return
          }
        }
      }

      if (onCyclePrevProject && isShortcutForAction(event, KeyboardShortcutAction.CyclePrevProject, shortcutConfig, { platform })) {
        event.preventDefault()
        onCyclePrevProject()
        return
      }

      if (onCycleNextProject && isShortcutForAction(event, KeyboardShortcutAction.CycleNextProject, shortcutConfig, { platform })) {
        event.preventDefault()
        onCycleNextProject()
        return
      }

      if (!isDiffViewerOpen && onSelectPrevSession && isShortcutForAction(event, KeyboardShortcutAction.SelectPrevSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectPrevSession()
        return
      }

      if (!isDiffViewerOpen && onSelectNextSession && isShortcutForAction(event, KeyboardShortcutAction.SelectNextSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectNextSession()
        return
      }

      if (onCancelSelectedSession && isShortcutForAction(event, KeyboardShortcutAction.ForceCancelSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onCancelSelectedSession(true)
        return
      }

      if (onCancelSelectedSession && isShortcutForAction(event, KeyboardShortcutAction.CancelSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onCancelSelectedSession(false)
        return
      }

      if (onResetSelection && isShortcutForAction(event, KeyboardShortcutAction.ResetSessionOrOrchestrator, shortcutConfig, { platform })) {
        event.preventDefault()
        onResetSelection()
        return
      }

      if (onOpenDiffViewer && isShortcutForAction(event, KeyboardShortcutAction.OpenDiffViewer, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenDiffViewer()
        return
      }

      if (onRefineSpec && isShortcutForAction(event, KeyboardShortcutAction.RefineSpec, shortcutConfig, { platform })) {
        event.preventDefault()
        onRefineSpec()
        return
      }

      if (onSpecSession && isShortcutForAction(event, KeyboardShortcutAction.ConvertSessionToSpec, shortcutConfig, { platform })) {
        event.preventDefault()
        onSpecSession()
        return
      }

      if (onPromoteSelectedVersion && isShortcutForAction(event, KeyboardShortcutAction.PromoteSessionVersion, shortcutConfig, { platform })) {
        event.preventDefault()
        onPromoteSelectedVersion()
        return
      }

      if (onFocusClaude && isShortcutForAction(event, KeyboardShortcutAction.FocusClaude, shortcutConfig, { platform })) {
        event.preventDefault()
        onFocusClaude()
        return
      }

      if (onFocusTerminal && isShortcutForAction(event, KeyboardShortcutAction.FocusTerminal, shortcutConfig, { platform })) {
        event.preventDefault()
        onFocusTerminal()
        return
      }

      if (onOpenSwitchModel && isShortcutForAction(event, KeyboardShortcutAction.OpenSwitchModelModal, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenSwitchModel()
        return
      }

      if (onOpenMergeModal && isShortcutForAction(event, KeyboardShortcutAction.OpenMergeModal, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenMergeModal()
        return
      }

      if (onUpdateSessionFromParent && isShortcutForAction(event, KeyboardShortcutAction.UpdateSessionFromParent, shortcutConfig, { platform })) {
        event.preventDefault()
        onUpdateSessionFromParent()
        return
      }

      if (onCreatePullRequest && isShortcutForAction(event, KeyboardShortcutAction.CreatePullRequest, shortcutConfig, { platform })) {
        event.preventDefault()
        onCreatePullRequest()
        return
      }

      if (onOpenInApp && isShortcutForAction(event, KeyboardShortcutAction.OpenInApp, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenInApp()
        return
      }

      if (onOpenSettings && isShortcutForAction(event, KeyboardShortcutAction.OpenSettings, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenSettings()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    onSelectOrchestrator,
    onSelectSession,
    sessionCount,
    projectCount,
    onSelectPrevSession,
    onSelectNextSession,
    onCancelSelectedSession,
    onOpenDiffViewer,
    onRefineSpec,
    onSpecSession,
    onPromoteSelectedVersion,
    onFocusClaude,
    onFocusTerminal,
    onResetSelection,
    onOpenSwitchModel,
    onOpenMergeModal,
    onUpdateSessionFromParent,
    onCreatePullRequest,
    onOpenInApp,
    onOpenSettings,
    onSwitchToProject,
    onCycleNextProject,
    onCyclePrevProject,
    isDiffViewerOpen,
    isModalOpen,
    shortcutConfig,
    platform,
  ])
}
