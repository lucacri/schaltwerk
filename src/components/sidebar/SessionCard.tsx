import { memo, useCallback, useEffect, useState, type CSSProperties } from "react";
import { clsx } from "clsx";
import { useAtomValue } from "jotai";
import { VscIssues, VscGitPullRequest } from "react-icons/vsc";
import { SessionActions } from "../session/SessionActions";
import { SessionInfo, SessionMonitorStatus } from "../../types/session";
import { UncommittedIndicator } from "../common/UncommittedIndicator";
import { InlineEditableText } from "../common/InlineEditableText";
import { theme, getAgentColorScheme } from "../../common/theme";
import type { MergeStatus } from "../../store/atoms/sessions";
import { lastAgentResponseMapAtom, agentResponseTickAtom, formatAgentResponseTime } from "../../store/atoms/lastAgentResponse";
import { getSessionDisplayName } from "../../utils/sessionDisplayName";
import { mapSessionUiState } from "../../utils/sessionFilters";
import { useMultipleShortcutDisplays } from "../../keyboardShortcuts/useShortcutDisplay";
import { KeyboardShortcutAction } from "../../keyboardShortcuts/config";
import { detectPlatformSafe } from "../../keyboardShortcuts/helpers";
import { useEpics } from "../../hooks/useEpics";
import { useTranslation } from "../../common/i18n/useTranslation";
import { getAgentColorKey, MetadataLinkBadge, openMetadataLink, sessionText } from './sessionCardStyles'
import { useSessionCardActions } from '../../contexts/SessionCardActionsContext'
import { useSessionActivity } from '../../store/hooks/useSessionActivity'

interface SessionCardProps {
  session: {
    info: SessionInfo;
    status?: SessionMonitorStatus;
    terminals: string[];
  };
  index: number;
  isSelected: boolean;

  hasFollowUpMessage: boolean;
  isWithinVersionGroup?: boolean;
  showPromoteIcon?: boolean;
  willBeDeleted?: boolean;
  isPromotionPreview?: boolean;
  onPromoteVersion?: () => void;
  onPromoteVersionHover?: () => void;
  onPromoteVersionHoverEnd?: () => void;
  isResetting?: boolean;
  isRunning?: boolean;
  disableMerge?: boolean;
  mergeStatus?: MergeStatus;
  isMarkReadyDisabled?: boolean;
  isBusy?: boolean;
  siblings?: SessionInfo[];
  onHover?: (sessionId: string | null) => void;
  isHighlighted?: boolean;
}

type SessionCardSurfaceOptions = {
  sessionState: SessionInfo['session_state']
  isSelected: boolean
  isReviewedState: boolean
  isRunning: boolean
  isIdle: boolean
  hasFollowUpMessage?: boolean
  willBeDeleted?: boolean
  isPromotionPreview?: boolean
  isHighlighted?: boolean
}

type SessionCardSurface = {
  className: string
  style: SessionCardSurfaceStyle
}

type SessionCardSurfaceStyle = CSSProperties & {
  '--session-card-bg'?: string
  '--session-card-hover-bg'?: string
  '--session-card-border'?: string
}

export function getSessionCardSurfaceClasses({
  sessionState,
  isSelected,
  isReviewedState: _isReviewedState,
  isRunning,
  isIdle,
  hasFollowUpMessage,
  willBeDeleted,
  isPromotionPreview,
  isHighlighted,
}: SessionCardSurfaceOptions): SessionCardSurface {
  const style: SessionCardSurfaceStyle = {
    '--session-card-bg': 'rgb(var(--color-bg-tertiary-rgb) / 0.4)',
    '--session-card-hover-bg': 'rgb(var(--color-bg-hover-rgb) / 0.4)',
    '--session-card-border': 'var(--color-border-default)',
  }

  let className = 'border-[var(--session-card-border)] bg-[var(--session-card-bg)] hover:bg-[var(--session-card-hover-bg)]'

  if (isHighlighted) {
    style['--session-card-border'] = 'var(--color-accent-purple-border)'
    style['--session-card-bg'] = 'rgb(var(--color-accent-purple-rgb) / 0.15)'
    style['--session-card-hover-bg'] = 'rgb(var(--color-accent-purple-rgb) / 0.2)'
    className = clsx(className, "ring-2 ring-[var(--color-accent-purple-border)] z-10")
  }

  if (sessionState === "running" || (sessionState === "spec" && isRunning)) {
    style['--session-card-border'] = 'var(--color-border-subtle)'
    style['--session-card-bg'] = 'rgb(var(--color-bg-elevated-rgb) / 0.5)'
    style['--session-card-hover-bg'] = 'rgb(var(--color-bg-hover-rgb) / 0.5)'
  } else if (sessionState === "spec") {
    style['--session-card-bg'] = 'rgb(var(--color-bg-tertiary-rgb) / 0.3)'
    style['--session-card-hover-bg'] = 'rgb(var(--color-bg-hover-rgb) / 0.35)'
  }

  if (willBeDeleted) {
    style['--session-card-border'] = 'var(--color-accent-red-border)'
    style['--session-card-bg'] = 'rgb(var(--color-accent-red-rgb) / 0.12)'
    style['--session-card-hover-bg'] = 'rgb(var(--color-accent-red-rgb) / 0.18)'
    className = clsx(className, "opacity-30 transition-all duration-200")
  }

  if (isPromotionPreview) {
    style['--session-card-border'] = 'transparent'
    className = clsx(className, "session-ring session-ring-green")
  } else if (isSelected) {
    style['--session-card-border'] = 'transparent'
    className = clsx(className, "session-ring session-ring-blue")
  }

  if (!willBeDeleted && !isSelected) {
    if (isIdle) {
      style['--session-card-bg'] = 'var(--color-accent-yellow-bg)'
      style['--session-card-hover-bg'] = 'var(--color-accent-yellow-bg)'
      style['--session-card-border'] = 'var(--color-accent-yellow-border)'
    }
    if (hasFollowUpMessage) {
      style['--session-card-bg'] = 'var(--color-accent-blue-bg)'
      style['--session-card-hover-bg'] = 'var(--color-accent-blue-bg)'
      className = clsx(className, "ring-2 ring-[var(--color-accent-blue-border)]")
    }
  }

  return { className, style }
}

export const SessionCard = memo<SessionCardProps>(
  ({
    session,
    index,
    isSelected,

    hasFollowUpMessage,
    isWithinVersionGroup = false,
    showPromoteIcon = false,
    willBeDeleted = false,
    isPromotionPreview = false,
    onPromoteVersion,
    onPromoteVersionHover,
    onPromoteVersionHoverEnd,
    isResetting = false,
    isRunning = false,
    disableMerge = false,
    mergeStatus = "idle",
    isMarkReadyDisabled = false,
    isBusy = false,
    siblings = [],
    onHover,
    isHighlighted = false
    }) => {
    const {
      onSelect, onMarkReady, onUnmarkReady, onCancel,
      onConvertToSpec, onRunDraft, onRefineSpec, onDeleteSpec,
      onReset, onRestartTerminals, onSwitchModel,
      onCreatePullRequest, onCreateGitlabMr,
      onMerge, onQuickMerge, onRename, onLinkPr,
    } = useSessionCardActions()

    const { t } = useTranslation();
    const { setItemEpic } = useEpics();
    const agentResponseMap = useAtomValue(lastAgentResponseMapAtom);
    useAtomValue(agentResponseTickAtom);
    const agentResponseTime = formatAgentResponseTime(agentResponseMap, session.info.session_id);
    const shortcuts = useMultipleShortcutDisplays([
      KeyboardShortcutAction.OpenDiffViewer,
      KeyboardShortcutAction.CancelSession,
      KeyboardShortcutAction.MarkSessionReady,
      KeyboardShortcutAction.SwitchToSession1,
      KeyboardShortcutAction.SwitchToSession2,
      KeyboardShortcutAction.SwitchToSession3,
      KeyboardShortcutAction.SwitchToSession4,
      KeyboardShortcutAction.SwitchToSession5,
      KeyboardShortcutAction.SwitchToSession6,
      KeyboardShortcutAction.SwitchToSession7,
      KeyboardShortcutAction.ForceCancelSession,
    ]);
    const platform = detectPlatformSafe();
    const modKey = platform === "mac" ? "⌘" : "Ctrl";
    const shiftModKey = platform === "mac" ? "⇧⌘" : "Ctrl+Shift";

    const getAccessibilityLabel = (isSelected: boolean, index: number) => {
      if (isSelected) {
        return `Selected session • Diff: ${shortcuts[KeyboardShortcutAction.OpenDiffViewer] || `${modKey}G`} • Cancel: ${shortcuts[KeyboardShortcutAction.CancelSession] || `${modKey}D`} (${shortcuts[KeyboardShortcutAction.ForceCancelSession] || `${shiftModKey}D`} force) • Mark Reviewed: ${shortcuts[KeyboardShortcutAction.MarkSessionReady] || `${modKey}R`}`;
      }
      if (index < 8) {
        const sessionActions = [
          KeyboardShortcutAction.SwitchToSession1,
          KeyboardShortcutAction.SwitchToSession2,
          KeyboardShortcutAction.SwitchToSession3,
          KeyboardShortcutAction.SwitchToSession4,
          KeyboardShortcutAction.SwitchToSession5,
          KeyboardShortcutAction.SwitchToSession6,
          KeyboardShortcutAction.SwitchToSession7,
        ];
        const sessionAction = sessionActions[index];
        return `Select session (${shortcuts[sessionAction] || `${modKey}${index + 2}`})`;
      }
      return "Select session";
    };
    const s = session.info;
    const activity = useSessionActivity(s.session_id);
    const sessionName = getSessionDisplayName(s);
    const taskDescription = (activity?.current_task ?? s.current_task) || s.spec_content;
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0;
    const deletions = s.diff_stats?.deletions || 0;
    const isBlocked = (activity?.is_blocked ?? s.is_blocked) || false;
    const isReadyToMerge = s.ready_to_merge || false;
    const promotionReason = s.promotionReason?.trim() || s.promotion_reason?.trim();
    const sessionState = mapSessionUiState(s);
    const isReviewedState = sessionState === "reviewed";
    const isSpecClarificationStarted = sessionState === "spec" && s.clarification_started === true;
    const specNotStarted = sessionState === "spec" && !isSpecClarificationStarted;
    const specWaitingForInput = isSpecClarificationStarted && s.attention_required === true;
    const isIdle = sessionState === "spec"
      ? specWaitingForInput
      : s.attention_required === true;
    const isClarificationRunning = isSpecClarificationStarted && !isIdle;
    const agentType =
      s.original_agent_type as SessionInfo["original_agent_type"];
    const agentKey = (agentType || "").toLowerCase();
    const agentLabel = agentKey;

    const agentColor = getAgentColorKey(agentKey);
    const colorScheme = getAgentColorScheme(agentColor);
    const hasUncommittedChanges = !!s.has_uncommitted_changes;
    const dirtyFilesCount =
      s.dirty_files_count
      ?? (hasUncommittedChanges ? Math.max(s.top_uncommitted_paths?.length ?? 0, 1) : 0);
    const showDirtyIndicator = hasUncommittedChanges || dirtyFilesCount > 0;
    const commitsAheadCount = s.commits_ahead_count ?? 0;
    const filesChanged = s.diff_stats?.files_changed ?? 0;
    const canCollapse = sessionState !== "spec";
    const [isExpanded, setIsExpanded] = useState<boolean>(isSelected || !canCollapse);
    const showExpandedDetails = !canCollapse || isExpanded;

    useEffect(() => {
      if (!canCollapse) {
        setIsExpanded(true);
        return;
      }
      if (isSelected) {
        setIsExpanded(true);
      }
    }, [canCollapse, isSelected]);

    const surface = getSessionCardSurfaceClasses({
      sessionState,
      isSelected,
      isReviewedState,
      isRunning: Boolean(isRunning) || isClarificationRunning,
      isIdle,
      hasFollowUpMessage,
      willBeDeleted,
      isPromotionPreview,
      isHighlighted,
    });

    const handleEpicChange = useCallback(
      (nextEpicId: string | null) => {
        void setItemEpic(s.session_id, nextEpicId);
      },
      [setItemEpic, s.session_id],
    );
    const handleOpenBadgeUrl = useCallback((url: string) => {
      openMetadataLink(url, s.session_id, 'SessionCard')
    }, [s.session_id])

    const metadataBadges = (
      <>
        {s.issue_number && s.issue_url && (
          <MetadataLinkBadge
            label={`#${s.issue_number}`}
            title={`Open issue #${s.issue_number}`}
            tone="issue"
            url={s.issue_url}
            onOpen={handleOpenBadgeUrl}
          >
            <VscIssues className="w-3 h-3" />
          </MetadataLinkBadge>
        )}
        {s.pr_number && s.pr_url && (
          <MetadataLinkBadge
            label={`PR #${s.pr_number}`}
            title={`Open PR #${s.pr_number}`}
            tone="pr"
            url={s.pr_url}
            onOpen={handleOpenBadgeUrl}
          >
            <VscGitPullRequest className="w-3 h-3" />
          </MetadataLinkBadge>
        )}
      </>
    )

    // State icon removed - no longer using emojis

    return (
      <div
        role="button"
        tabIndex={isBusy ? -1 : 0}
        aria-disabled={isBusy}
        aria-busy={isBusy}
        onClick={() => {
          if (isBusy) return;
          if (canCollapse) {
            setIsExpanded((previous) => !previous);
          }
          onSelect(session.info.session_id);
        }}
        onKeyDown={(e) => {
          if (isBusy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (canCollapse) {
              setIsExpanded((previous) => !previous);
            }
            onSelect(session.info.session_id);
          }
        }}
        onMouseEnter={() => onHover?.(session.info.session_id)}
        onMouseLeave={() => onHover?.(null)}
        data-session-id={session.info.session_id}
        data-session-selected={isSelected ? "true" : "false"}
        className={clsx(
          "group relative w-full text-left pl-4 pr-3 py-2.5 rounded-md mb-2 border transition-all duration-300",
          surface.className,
          isBusy ? "cursor-progress opacity-60" : "cursor-pointer",
        )}
        style={surface.style}
        aria-label={getAccessibilityLabel(isSelected, index)}
      >
        {(sessionState !== "spec" || isRunning || isSpecClarificationStarted || specNotStarted) && (() => {
          const isActivelyRunning = !isIdle && ((sessionState === "running" || isRunning) && !isReadyToMerge || isClarificationRunning)
          const stripColor = isIdle
            ? "var(--color-accent-yellow)"
            : isActivelyRunning
              ? "var(--color-accent-blue)"
              : specNotStarted
                ? "var(--color-border-subtle)"
              : isReviewedState
                ? "var(--color-accent-green)"
                : "var(--color-border-subtle)"
          return (
            <div
              className={clsx("absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md", isActivelyRunning && "session-status-pulse")}
              style={{ backgroundColor: stripColor }}
            />
          )
        })()}
        {isBusy && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-md pointer-events-none"
            data-testid="session-busy-indicator"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              opacity: 0.72,
            }}
          >
            <span
              className="h-4 w-4 border-2 border-solid rounded-full animate-spin"
              style={{
                borderColor: "var(--color-accent-blue-border)",
                borderTopColor: "transparent",
              }}
            />
          </div>
        )}
        <div
          className="flex items-start justify-between gap-2"
          style={{ marginBottom: "8px" }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate flex items-center gap-2" style={sessionText.title}>
                {onRename ? (
                  <InlineEditableText
                    value={sessionName}
                    onSave={(newName) => onRename(s.session_id, newName)}
                    textStyle={sessionText.title}
                    disabled={isBusy}
                  />
                ) : (
                  sessionName
                )}
              </div>
            {sessionState === "spec" && s.spec_stage && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: s.spec_stage === "clarified"
                    ? "var(--color-accent-green-light)"
                    : "var(--color-accent-yellow-light)",
                }}
              >
                {s.spec_stage === "clarified" ? "Clarified" : "Draft"}
              </span>
            )}
            {specNotStarted && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-text-muted)",
                }}
              >
                {t.session.notStarted}
              </span>
            )}
            {specWaitingForInput && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-accent-yellow-light)",
                }}
              >
                {t.session.waitingForInput}
              </span>
            )}
            {isClarificationRunning && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-accent-blue-light)",
                }}
              >
                {t.session.running}
              </span>
            )}
            {isIdle && !specWaitingForInput && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-accent-yellow-light)",
                }}
              >
                {t.session.idle}
              </span>
            )}
            {isReviewedState && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-accent-green-light)",
                }}
              >
                {t.session.reviewed}
              </span>
            )}
            {isBlocked && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-accent-red-light)",
                }}
              >
                {t.session.blocked}
              </span>
            )}
            {promotionReason && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-[1px]"
                title={promotionReason}
                style={{
                  ...sessionText.badge,
                  backgroundColor: "var(--color-accent-green-bg)",
                  color: "var(--color-accent-green-light)",
                  borderColor: "var(--color-accent-green-border)",
                }}
              >
                {t.session.promoted}
              </span>
            )}

            {hasFollowUpMessage && !isReadyToMerge && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-1"
                title={t.sessionCard.newFollowUp}
              >
                <span className="flex h-4 w-4 relative">
                  <span
                    className="absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{
                      backgroundColor: "var(--color-accent-blue-light)",
                    }}
                  ></span>
                  <span
                    className="relative inline-flex rounded-full h-4 w-4 items-center justify-center font-bold"
                    style={{
                      ...sessionText.badge,
                      fontSize: theme.fontSize.caption,
                      backgroundColor: "var(--color-accent-blue)",
                      color: "var(--color-text-inverse)",
                    }}
                  >
                    !
                  </span>
                </span>
              </span>
            )}
            </div>
            {taskDescription && (
              <div
                className="truncate mt-0.5"
                style={sessionText.meta}
                title={taskDescription}
              >
                {taskDescription}
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 flex-shrink-0">
            {index < 8 && (
              <span
                className="px-1.5 py-0.5 rounded"
                style={{
                  ...sessionText.meta,
                  backgroundColor: "rgb(var(--color-bg-hover-rgb) / 0.6)",
                }}
              >
                {(() => {
                  const sessionActions = [
                    KeyboardShortcutAction.SwitchToSession1,
                    KeyboardShortcutAction.SwitchToSession2,
                    KeyboardShortcutAction.SwitchToSession3,
                    KeyboardShortcutAction.SwitchToSession4,
                    KeyboardShortcutAction.SwitchToSession5,
                    KeyboardShortcutAction.SwitchToSession6,
                    KeyboardShortcutAction.SwitchToSession7,
                  ];
                  const sessionAction = sessionActions[index];
                  return shortcuts[sessionAction] || `${modKey}${index + 2}`;
                })()}
              </span>
            )}
          </div>
        </div>
        {sessionState !== "spec" && (
          <div
            className="mt-1 flex items-center gap-2 flex-wrap"
            style={sessionText.meta}
          >
            {showDirtyIndicator ? (
              <UncommittedIndicator
                className="flex-shrink-0"
                count={dirtyFilesCount}
                sessionName={sessionName}
                samplePaths={s.top_uncommitted_paths}
              />
            ) : (
              <span
                data-testid="session-card-stat-dirty"
                className="inline-flex items-center gap-1 rounded border px-1.5 py-[1px]"
                style={{
                  ...sessionText.badge,
                  color: "var(--color-text-tertiary)",
                  backgroundColor: "rgb(var(--color-bg-hover-rgb) / 0.35)",
                  borderColor: "var(--color-border-subtle)",
                }}
                title={`Dirty files: ${dirtyFilesCount}`}
              >
                {dirtyFilesCount} dirty
              </span>
            )}
            <span
              data-testid="session-card-stat-ahead"
              className="inline-flex items-center gap-1 rounded border px-1.5 py-[1px]"
              style={{
                ...sessionText.badge,
                color: commitsAheadCount > 0 ? "var(--color-accent-blue-light)" : "var(--color-text-tertiary)",
                backgroundColor: commitsAheadCount > 0 ? "var(--color-accent-blue-bg)" : "rgb(var(--color-bg-hover-rgb) / 0.35)",
                borderColor: commitsAheadCount > 0 ? "var(--color-accent-blue-border)" : "var(--color-border-subtle)",
              }}
              title={`Commits ahead of ${s.base_branch}: ${commitsAheadCount}`}
            >
              {commitsAheadCount} ahead
            </span>
            <span
              data-testid="session-card-stat-diff"
              className="inline-flex items-center gap-1 rounded border px-1.5 py-[1px]"
              style={{
                ...sessionText.badge,
                color: "var(--color-text-secondary)",
                backgroundColor: "rgb(var(--color-bg-hover-rgb) / 0.35)",
                borderColor: "var(--color-border-subtle)",
              }}
              title={`Diff summary: ${filesChanged} files, +${additions}, -${deletions}`}
            >
              <span>{filesChanged} files</span>
              <span style={{ color: "var(--color-accent-green-light)" }}>+{additions}</span>
              <span style={{ color: "var(--color-accent-red-light)" }}>-{deletions}</span>
            </span>
          </div>
        )}
        {showExpandedDetails && (
          <div
            className="mt-1 flex items-center gap-2"
            style={sessionText.meta}
          >
            {sessionState === "spec" ? (
              <>
                <span
                  className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-[1px] rounded border"
                  style={{
                    ...sessionText.badge,
                    backgroundColor: "var(--color-accent-amber-bg)",
                    color: "var(--color-accent-amber-light)",
                    borderColor: "var(--color-accent-amber-border)",
                  }}
                >
                  {t.session.spec}
                </span>
                {metadataBadges}
              </>
            ) : (
              <>
                {agentType && !isWithinVersionGroup && (
                  <span
                    className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-[1px] rounded border"
                    style={{
                      ...sessionText.badge,
                      backgroundColor: colorScheme.bg,
                      color: colorScheme.light,
                      borderColor: colorScheme.border,
                    }}
                    title={`Agent: ${agentLabel}`}
                  >
                    <span
                      className="w-1 h-1 rounded-full"
                      style={{
                        backgroundColor: colorScheme.DEFAULT,
                      }}
                    />
                    {agentLabel}
                  </span>
                )}
                {s.is_consolidation && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span
                      className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border"
                      style={{
                        ...sessionText.badge,
                        backgroundColor: 'var(--color-accent-purple-bg)',
                        color: 'var(--color-accent-purple-light)',
                        borderColor: 'var(--color-accent-purple-border)',
                      }}
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM3 5v3.5a.5.5 0 0 0 .5.5H8v3h0V9h4.5a.5.5 0 0 0 .5-.5V5h-1v3H8.5V5h-1v3H4V5H3z" />
                      </svg>
                      MERGE
                    </span>
                    
                    {s.consolidation_sources && s.consolidation_sources.length > 0 && (
                      <div className="flex items-center">
                        <span className="mr-1 text-muted text-caption">←</span>
                        <div className="flex items-center -space-x-1">
                          {s.consolidation_sources.map((sourceId, i) => {
                            const source = siblings.find(sib => sib.session_id === sourceId)
                            const agentType = source?.original_agent_type || 'terminal'
                            const scheme = getAgentColorScheme(getAgentColorKey(agentType))
                            const version = source?.version_number
                            
                            return (
                              <div 
                                key={sourceId}
                                className="flex items-center justify-center w-4 h-4 rounded-full border border-[var(--color-bg-primary)]"
                                style={{ 
                                  backgroundColor: scheme.DEFAULT,
                                  zIndex: 10 - i 
                                }}
                                title={source ? `${agentType}${version ? ` (v${version})` : ''}` : `Session ${sourceId}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {metadataBadges}
                {promotionReason && (
                  <span
                    className="truncate max-w-[200px]"
                    title={promotionReason}
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {promotionReason}
                  </span>
                )}
                <span className="truncate max-w-[120px]" title={s.branch}>
                  {s.branch}
                </span>
                {agentResponseTime && (
                  <span
                    style={{ color: "var(--color-text-muted)" }}
                    title={t.session.lastAgentOutput}
                  >
                    {agentResponseTime}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {showExpandedDetails && (
        <div
          className="mt-2 flex items-center justify-between"
          data-testid="session-card-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <SessionActions
            sessionState={sessionState as "spec" | "running" | "reviewed"}
            isReadyToMerge={isReadyToMerge}
            sessionId={s.session_id}
            sessionSlug={s.session_id}
            worktreePath={s.worktree_path}
            branch={s.branch}
            defaultBranch={s.parent_branch ?? undefined}
            showPromoteIcon={showPromoteIcon}
            onCreatePullRequest={onCreatePullRequest}
            onCreateGitlabMr={onCreateGitlabMr}
            prNumber={s.pr_number}
            prUrl={s.pr_url}
            onRunSpec={onRunDraft}
            onRefineSpec={onRefineSpec}
            onDeleteSpec={onDeleteSpec}
            onMarkReviewed={onMarkReady}
            onUnmarkReviewed={onUnmarkReady}
            onCancel={onCancel}
            onConvertToSpec={onConvertToSpec}
            onPromoteVersion={onPromoteVersion}
            onPromoteVersionHover={onPromoteVersionHover}
            onPromoteVersionHoverEnd={onPromoteVersionHoverEnd}
            onReset={onReset}
            onRestartTerminals={onRestartTerminals}
            onSwitchModel={onSwitchModel}
            isResetting={isResetting}
            onMerge={onMerge}
            onQuickMerge={onQuickMerge}
            disableMerge={disableMerge}
            mergeStatus={mergeStatus}
            mergeConflictingPaths={s.merge_conflicting_paths}
            isMarkReadyDisabled={isMarkReadyDisabled}
            onLinkPr={onLinkPr}
            epic={s.epic}
            onEpicChange={handleEpicChange}
            epicDisabled={isBusy}
          />
        </div>
        )}
      </div>
    );
});
