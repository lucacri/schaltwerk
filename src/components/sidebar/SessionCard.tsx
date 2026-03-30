import { memo, useCallback, type CSSProperties } from "react";
import { clsx } from "clsx";
import { useAtomValue } from "jotai";
import { VscIssues, VscGitPullRequest } from "react-icons/vsc";
import { SessionActions } from "../session/SessionActions";
import { SessionInfo, SessionMonitorStatus } from "../../types/session";
import { UncommittedIndicator } from "../common/UncommittedIndicator";
import { ProgressIndicator } from "../common/ProgressIndicator";
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
  onSelect: (sessionId: string) => void;
  onMarkReady: (sessionId: string) => void;
  onUnmarkReady: (sessionId: string) => void;
  onCancel: (sessionId: string, hasUncommitted: boolean) => void;
  onConvertToSpec?: (sessionId: string) => void;
  onRunDraft?: (sessionId: string) => void;
  onRefineSpec?: (sessionId: string) => void;
  onDeleteSpec?: (sessionId: string) => void;
  onPromoteVersion?: () => void;
  onPromoteVersionHover?: () => void;
  onPromoteVersionHoverEnd?: () => void;
  onReset?: (sessionId: string) => void;
  onRestartTerminals?: (sessionId: string) => void;
  onSwitchModel?: (sessionId: string) => void;
  onCreatePullRequest?: (sessionId: string) => void;
  onCreateGitlabMr?: (sessionId: string) => void;
  isResetting?: boolean;
  isRunning?: boolean;
  onMerge?: (sessionId: string) => void;
  onQuickMerge?: (sessionId: string) => void;
  disableMerge?: boolean;
  mergeStatus?: MergeStatus;
  isMarkReadyDisabled?: boolean;
  isBusy?: boolean;
  onRename?: (sessionId: string, newName: string) => Promise<void>;
  onLinkPr?: (sessionId: string, prNumber: number, prUrl: string) => void;
  siblings?: SessionInfo[];
  onHover?: (sessionId: string | null) => void;
  isHighlighted?: boolean;
}

function getSessionStateColor(state?: string): "green" | "violet" | "gray" {
  switch (state) {
    case "active":
      return "green";
    case "review":
    case "ready":
      return "violet";
    case "stale":
    default:
      return "gray";
  }
}

type SessionCardSurfaceOptions = {
  sessionState: SessionInfo['session_state']
  isSelected: boolean
  isReviewedState: boolean
  isRunning: boolean
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
  isReviewedState,
  isRunning,
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

  if (sessionState === "running") {
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
  } else if (isReviewedState) {
    style['--session-card-border'] = 'transparent'
    className = clsx(className, "session-ring session-ring-green opacity-90")
  }

  if (!willBeDeleted && !isSelected) {
    if (hasFollowUpMessage) {
      style['--session-card-bg'] = 'var(--color-accent-blue-bg)'
      style['--session-card-hover-bg'] = 'var(--color-accent-blue-bg)'
      className = clsx(className, "ring-2 ring-[var(--color-accent-blue-border)]")
    }
    if (isRunning) {
      style['--session-card-bg'] = 'var(--color-accent-magenta-bg)'
      style['--session-card-hover-bg'] = 'var(--color-accent-magenta-bg)'
      className = clsx(className, "ring-2 ring-[var(--color-accent-magenta-border)]")
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
    onSelect,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToSpec,
    onRunDraft,
    onRefineSpec,
    onDeleteSpec,
    onPromoteVersion,
    onPromoteVersionHover,
    onPromoteVersionHoverEnd,
    onReset,
    onRestartTerminals,
    onSwitchModel,
    onCreatePullRequest,
    onCreateGitlabMr,
    isResetting = false,
    isRunning = false,
    onMerge,
    onQuickMerge,
    disableMerge = false,
    mergeStatus = "idle",
    isMarkReadyDisabled = false,
    isBusy = false,
    onRename,
    onLinkPr,
    siblings = [],
    onHover,
    isHighlighted = false
    }) => {

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
    const color = getSessionStateColor(s.session_state);
    const sessionName = getSessionDisplayName(s);
    const taskDescription = s.current_task || s.spec_content;
    const progressPercent = s.todo_percentage || 0;
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0;
    const deletions = s.diff_stats?.deletions || 0;
    const isBlocked = s.is_blocked || false;
    const isReadyToMerge = s.ready_to_merge || false;
    const sessionState = mapSessionUiState(s);
    const isReviewedState = sessionState === "reviewed";
    const agentType =
      s.original_agent_type as SessionInfo["original_agent_type"];
    const agentKey = (agentType || "").toLowerCase();
    const agentLabel = agentKey;

    const agentColor = getAgentColorKey(agentKey);
    const colorScheme = getAgentColorScheme(agentColor);
    const showReviewedDirtyBadge =
      isReviewedState && !isReadyToMerge && !!s.has_uncommitted_changes;

    const surface = getSessionCardSurfaceClasses({
      sessionState,
      isSelected,
      isReviewedState,
      isRunning: Boolean(isRunning),
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
          onSelect(session.info.session_id);
        }}
        onKeyDown={(e) => {
          if (isBusy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(session.info.session_id);
          }
        }}
        onMouseEnter={() => onHover?.(session.info.session_id)}
        onMouseLeave={() => onHover?.(null)}
        data-session-id={session.info.session_id}
        data-session-selected={isSelected ? "true" : "false"}
        className={clsx(
          "group relative w-full text-left px-3 py-2.5 rounded-md mb-2 border transition-all duration-300",
          surface.className,
          isBusy ? "cursor-progress opacity-60" : "cursor-pointer",
        )}
        style={surface.style}
        aria-label={getAccessibilityLabel(isSelected, index)}
      >
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
          <div className="flex-1 min-w-0 flex items-center gap-2">
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
            {sessionState !== "spec" && (
              <div className="flex-shrink-0 flex items-center">
                {!s.attention_required &&
                  sessionState === "running" &&
                  !isReadyToMerge && <ProgressIndicator size="sm" />}
                {s.attention_required && (
                  <span
                    className="idle-indicator"
                    style={{
                      fontSize: theme.fontSize.caption,
                      lineHeight: theme.lineHeight.compact,
                      fontFamily: theme.fontFamily.sans,
                      fontWeight: 600,
                      color: "var(--color-accent-yellow-light)",
                    }}
                  >
                    {t.session.idle}
                  </span>
                )}
                {isRunning && isReviewedState && (
                  <span
                    className="px-1.5 py-0.5 rounded border"
                    style={{
                      ...sessionText.badge,
                      backgroundColor: "var(--color-accent-magenta-bg)",
                      color: "var(--color-accent-magenta)",
                      borderColor: "var(--color-accent-magenta-border)",
                    }}
                  >
                    {t.session.running}
                  </span>
                )}
              </div>
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

            {showReviewedDirtyBadge && (
              <UncommittedIndicator
                className="flex-shrink-0"
                sessionName={sessionName}
                samplePaths={s.top_uncommitted_paths}
              />
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
          <div className="flex items-center gap-2 flex-shrink-0">
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
        {taskDescription && (
          <div
            className="truncate"
            style={{
              ...sessionText.agent,
              color: "var(--color-text-primary)",
            }}
            title={taskDescription}
          >
            {taskDescription}
          </div>
        )}
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
              <span style={{ color: "var(--color-accent-green-light)" }}>+{additions}</span>
              <span style={{ color: "var(--color-accent-red-light)" }}>-{deletions}</span>
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
        {progressPercent > 0 && (
          <>
            <div className="mt-3 h-2 rounded bg-[var(--color-bg-tertiary)]">
              <div
                className="h-2 rounded"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor:
                    color === "green"
                      ? "var(--color-accent-green)"
                      : color === "violet"
                        ? "var(--color-accent-violet)"
                        : "var(--color-text-muted)",
                }}
              />
            </div>
            <div className="mt-1" style={sessionText.meta}>
              {progressPercent}{t.session.complete}
            </div>
          </>
        )}
        <div className="mt-2 flex items-center justify-between">
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
      </div>
    );
});
