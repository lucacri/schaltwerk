# Tauri Command Reachability Map

**Date:** 2026-05-03
**Scope:** Tier 1.3 audit. Cross-references every `#[tauri::command]`-registered backend handler with frontend `TauriCommands.X` invocations, the MCP REST shim (`src-tauri/src/mcp_api.rs`), and test-only references.
**Status:** Doc-only. No code changes recommended pre-merge.

## 1. Inventory

| Surface | Count |
|---|---|
| Backend commands registered in `tauri::generate_handler![...]` (main.rs:1460-1805) | **324** |
| Frontend `TauriCommands` enum entries (`src/common/tauriCommands.ts`) | **303** |
| MCP server tools (HTTP-only; not Tauri invoke callers) | n/a (HTTP REST via `/api/*`, see Note A) |
| `#[tauri::command]` decoration sites in `src-tauri/src/` | 328 (4 duplicate function names; see Surprises) |

**Note A — MCP server reachability:** The `mcp-server/` package does not call Tauri commands by name. It uses `node-fetch` against `http://<host>:<port>/api/...` — see `mcp-server/src/lucode-bridge.ts`. The relevant cross-reference within this repo is `src-tauri/src/mcp_api.rs`, which imports the underlying Rust functions directly (e.g. `schaltwerk_core_cancel_session(...)`) — these calls are Rust-level, not Tauri-`invoke`-level. The "mcp_api refs" column counts how many times the command's symbol appears in `mcp_api.rs`. A non-zero value means the same Rust function is reused by the REST layer — registration as a Tauri command remains needed only if a frontend caller exists.

## 2. Match Table

Column legend:
- **FE invoke**: `prod_count + test_count`. Number of `invoke<...>(TauriCommands.<key>, ...)` call sites in `src/`. Multi-line invokes are detected.
- **FE wrapper**: production references where the enum entry is bound through a wrapper (e.g. `loadCommand: TauriCommands.X`, ternary dispatch in `powerSettings.ts`, etc.). Wrapper bindings invoke the command at runtime via `invoke(config.loadCommand)`.
- **Test mock-only**: occurrences inside `*.test.ts(x)` that are NOT `invoke()` (i.e. `case TauriCommands.X:`, `cmd === TauriCommands.X`, `expect(...).toHaveBeenCalledWith(TauriCommands.X)`, `not.toHaveBeenCalledWith(...)`). These are dormant unless a real invoke fires them.
- **mcp_api refs**: occurrences of the Rust function symbol in `src-tauri/src/mcp_api.rs`.

| Backend Command | Enum Entry | FE invoke | FE wrapper | Test mock-only | mcp_api refs | Notes |
|---|---|---|---|---|---|---|
| add_recent_project | AddRecentProject | 2+0t | 0 | 4 | 0 |  |
| check_folder_access | CheckFolderAccess | 1+0t | 0 | 4 | 0 |  |
| clipboard_write_text | ClipboardWriteText | 4+0t | 0 | 8 | 0 |  |
| close_project | CloseProject | 1+0t | 0 | 4 | 0 |  |
| close_terminal | CloseTerminal | 3+0t | 0 | 14 | 0 |  |
| compute_commit_unified_diff | ComputeCommitUnifiedDiff | 1+0t | 0 | 0 | 0 |  |
| compute_split_diff_backend | ComputeSplitDiffBackend | 1+0t | 0 | 1 | 0 |  |
| compute_unified_diff_backend | ComputeUnifiedDiffBackend | 2+0t | 0 | 11 | 0 |  |
| configure_mcp_for_project | ConfigureMcpForProject | 1+0t | 0 | 0 | 0 |  |
| create_new_project | CreateNewProject | 1+0t | 0 | 10 | 0 |  |
| create_run_terminal | CreateRunTerminal | 1+0t | 0 | 5 | 0 |  |
| create_terminal | CreateTerminal | 1+0t | 0 | 14 | 0 |  |
| create_terminal_with_size | CreateTerminalWithSize | 1+0t | 0 | 21 | 0 |  |
| detect_agent_binaries | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| detect_all_agent_binaries | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| detect_project_forge | DetectProjectForge | 1+0t | 0 | 1 | 0 |  |
| directory_exists | DirectoryExists | 4+0t | 0 | 10 | 0 |  |
| disable_global_keep_awake | DisableGlobalKeepAwake | 0+0t | 1 | 0 | 0 |  |
| enable_global_keep_awake | EnableGlobalKeepAwake | 0+0t | 1 | 0 | 0 |  |
| ensure_folder_permission | EnsureFolderPermission | 1+0t | 0 | 2 | 0 |  |
| ensure_mcp_gitignored | EnsureMcpGitignored | 1+0t | 0 | 0 | 0 |  |
| forge_approve_pr | ForgeApprovePr | 1+0t | 0 | 1 | 0 |  |
| forge_comment_on_issue | ForgeCommentOnIssue | 0+0t | 1 | 0 | 0 |  |
| forge_comment_on_pr | ForgeCommentOnPr | 1+0t | 1 | 1 | 0 |  |
| forge_create_session_pr | ForgeCreateSessionPr | 1+0t | 0 | 1 | 0 |  |
| forge_generate_writeback | ForgeGenerateWriteback | 1+0t | 0 | 0 | 0 |  |
| forge_get_issue_details | ForgeGetIssueDetails | 1+0t | 0 | 1 | 0 |  |
| forge_get_pr_details | ForgeGetPrDetails | 1+0t | 0 | 1 | 0 |  |
| forge_get_review_comments | ForgeGetReviewComments | 1+0t | 0 | 1 | 0 |  |
| forge_get_status | ForgeGetStatus | 1+0t | 0 | 3 | 0 |  |
| forge_merge_pr | ForgeMergePr | 1+0t | 0 | 1 | 0 |  |
| forge_proxy_image | ForgeProxyImage | 1+0t | 0 | 0 | 0 |  |
| forge_search_issues | ForgeSearchIssues | 1+0t | 0 | 1 | 0 |  |
| forge_search_prs | ForgeSearchPrs | 1+0t | 0 | 1 | 0 |  |
| get_active_file_watchers | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_active_project_path | GetActiveProjectPath | 7+0t | 0 | 19 | 0 |  |
| get_agent_binary_config | GetAgentBinaryConfig | 3+0t | 0 | 1 | 0 |  |
| get_agent_cli_args | GetAgentCliArgs | 1+0t | 0 | 1 | 0 |  |
| get_agent_command_prefix | GetAgentCommandPrefix | 1+0t | 0 | 0 | 0 |  |
| get_agent_env_vars | GetAgentEnvVars | 1+0t | 0 | 1 | 0 |  |
| get_agent_initial_command | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_agent_preferences | GetAgentPreferences | 1+0t | 0 | 1 | 0 |  |
| get_agent_presets | GetAgentPresets | 0+1t | 1 | 2 | 1 | mcp_api(1) |
| get_agent_variants | GetAgentVariants | 0+1t | 1 | 1 | 0 |  |
| get_all_agent_binary_configs | GetAllAgentBinaryConfigs | 3+0t | 0 | 2 | 0 |  |
| get_all_terminal_activity | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_amp_mcp_servers | GetAmpMcpServers | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| get_app_version | GetAppVersion | 1+0t | 0 | 1 | 0 |  |
| get_base_branch_name | GetBaseBranchName | 2+0t | 0 | 36 | 0 |  |
| get_changed_files_from_main | GetChangedFilesFromMain | 4+0t | 0 | 45 | 0 |  |
| get_commit_comparison_info | GetCommitComparisonInfo | 2+0t | 0 | 36 | 0 |  |
| get_commit_file_contents | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_commit_files | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_contextual_actions | GetContextualActions | 0+1t | 1 | 1 | 0 |  |
| get_current_branch_name | GetCurrentBranchName | 4+0t | 0 | 47 | 0 |  |
| get_current_directory | GetCurrentDirectory | 1+0t | 0 | 13 | 0 |  |
| get_default_generation_prompts | GetDefaultGenerationPrompts | 2+0t | 0 | 8 | 0 |  |
| get_default_open_app | GetDefaultOpenApp | 1+0t | 0 | 15 | 0 |  |
| get_dev_error_toasts_enabled | GetDevErrorToastsEnabled | 2+0t | 0 | 3 | 0 |  |
| get_development_info | GetDevelopmentInfo | 2+0t | 0 | 0 | 0 |  |
| get_diff_view_preferences | GetDiffViewPreferences | 4+0t | 0 | 33 | 0 |  |
| get_editor_overrides | GetEditorOverrides | 2+0t | 0 | 11 | 0 |  |
| get_effective_agent_binary_path | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_enabled_agents | GetEnabledAgents | 2+0t | 0 | 1 | 0 |  |
| get_enabled_open_app_ids | GetEnabledOpenAppIds | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| get_environment_variable | GetEnvironmentVariable | 1+0t | 0 | 0 | 0 |  |
| get_favorite_order | GetFavoriteOrder | 1+0t | 0 | 1 | 0 |  |
| get_file_diff_from_main | GetFileDiffFromMain | 2+0t | 0 | 8 | 0 |  |
| get_generation_settings | GetGenerationSettings | 2+0t | 0 | 11 | 4 | mcp_api(4) |
| get_git_graph_commit_files | GetGitGraphCommitFiles | 2+0t | 0 | 3 | 0 |  |
| get_git_graph_history | GetGitGraphHistory | 1+0t | 0 | 4 | 0 |  |
| get_git_history | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_global_keep_awake_state | GetGlobalKeepAwakeState | 2+0t | 0 | 0 | 0 |  |
| get_keyboard_shortcuts | GetKeyboardShortcuts | 2+0t | 0 | 2 | 0 |  |
| get_last_project_parent_directory | GetLastProjectParentDirectory | 2+0t | 0 | 14 | 0 |  |
| get_mcp_status | GetMcpStatus | 1+0t | 0 | 4 | 0 |  |
| get_open_tabs_state | GetOpenTabsState | 1+0t | 0 | 0 | 0 |  |
| get_orchestrator_working_changes | GetOrchestratorWorkingChanges | 3+0t | 0 | 18 | 0 |  |
| get_permission_diagnostics | GetPermissionDiagnostics | 1+0t | 0 | 3 | 0 |  |
| get_project_action_buttons | GetProjectActionButtons | 2+0t | 0 | 15 | 0 |  |
| get_project_agent_plugin_config | GetProjectAgentPluginConfig | 1+0t | 0 | 3 | 0 |  |
| get_project_default_base_branch | GetProjectDefaultBaseBranch | 2+0t | 0 | 3 | 0 |  |
| get_project_default_branch | GetProjectDefaultBranch | 2+0t | 0 | 3 | 0 |  |
| get_project_environment_variables | GetProjectEnvironmentVariables | 1+0t | 0 | 1 | 0 |  |
| get_project_merge_preferences | GetProjectMergePreferences | 2+0t | 0 | 11 | 0 |  |
| get_project_run_script | GetProjectRunScript | 4+0t | 0 | 9 | 2 | mcp_api(2) |
| get_project_sessions_settings | GetProjectSessionsSettings | 1+0t | 0 | 14 | 0 |  |
| get_project_settings | GetProjectSettings | 3+0t | 0 | 14 | 0 |  |
| get_raw_agent_order | GetRawAgentOrder | 1+0t | 0 | 1 | 0 |  |
| get_recent_projects | GetRecentProjects | 1+0t | 0 | 2 | 0 |  |
| get_restore_open_projects | GetRestoreOpenProjects | 2+0t | 0 | 0 | 0 |  |
| get_session_preferences | GetSessionPreferences | 3+0t | 0 | 11 | 0 |  |
| get_terminal_activity_status | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| get_terminal_buffer | GetTerminalBuffer | 1+0t | 0 | 6 | 0 |  |
| get_terminal_settings | GetTerminalSettings | 3+0t | 0 | 0 | 0 |  |
| get_terminal_ui_preferences | GetTerminalUiPreferences | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| get_tutorial_completed | GetTutorialCompleted | 1+0t | 0 | 0 | 0 |  |
| get_uncommitted_file_diff | GetUncommittedFileDiff | 1+0t | 0 | 0 | 0 |  |
| get_uncommitted_files | GetUncommittedFiles | 2+0t | 0 | 30 | 0 |  |
| github_authenticate | GitHubAuthenticate | 1+0t | 0 | 1 | 0 |  |
| github_connect_project | GitHubConnectProject | 1+0t | 0 | 0 | 0 |  |
| github_create_reviewed_pr | GitHubCreateReviewedPr | 1+0t | 0 | 1 | 0 |  |
| github_create_session_pr | GitHubCreateSessionPr | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| github_get_issue_details | GitHubGetIssueDetails | 1+0t | 0 | 0 | 0 |  |
| github_get_pr_details | GitHubGetPrDetails | 1+0t | 0 | 1 | 0 |  |
| github_get_pr_feedback | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| github_get_pr_review_comments | GitHubGetPrReviewComments | 1+0t | 0 | 0 | 0 |  |
| github_get_status | GitHubGetStatus | 1+0t | 0 | 1 | 0 |  |
| github_preview_pr | GitHubPreviewPr | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| github_search_issues | GitHubSearchIssues | 1+0t | 0 | 0 | 0 |  |
| github_search_prs | GitHubSearchPrs | 1+0t | 0 | 1 | 0 |  |
| gitlab_approve_mr | GitLabApproveMr | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| gitlab_comment_on_mr | GitLabCommentOnMr | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| gitlab_create_mr | GitLabCreateMr | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| gitlab_create_session_mr | GitLabCreateSessionMr | 0+0t | 0 | 0 | 2 | mcp_api(2) |
| gitlab_get_issue_details | GitLabGetIssueDetails | 1+0t | 0 | 0 | 0 |  |
| gitlab_get_mr_details | GitLabGetMrDetails | 1+0t | 0 | 0 | 0 |  |
| gitlab_get_mr_pipeline | GitLabGetMrPipeline | 2+0t | 0 | 0 | 0 |  |
| gitlab_get_pipeline_jobs | GitLabGetPipelineJobs | 1+0t | 0 | 0 | 0 |  |
| gitlab_get_sources | GitLabGetSources | 2+0t | 0 | 4 | 0 |  |
| gitlab_get_status | GitLabGetStatus | 1+0t | 0 | 0 | 0 |  |
| gitlab_merge_mr | GitLabMergeMr | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| gitlab_search_issues | GitLabSearchIssues | 1+0t | 0 | 0 | 0 |  |
| gitlab_search_mrs | GitLabSearchMrs | 1+0t | 0 | 2 | 0 |  |
| gitlab_set_sources | GitLabSetSources | 1+0t | 0 | 0 | 0 |  |
| has_remote_tracking_branch | HasRemoteTrackingBranch | 1+0t | 0 | 0 | 0 |  |
| initialize_project | InitializeProject | 2+0t | 0 | 17 | 0 |  |
| is_file_watcher_active | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| is_git_repository | IsGitRepository | 3+0t | 0 | 2 | 0 |  |
| list_available_open_apps | ListAvailableOpenApps | 1+0t | 0 | 14 | 0 |  |
| list_installed_fonts | ListInstalledFonts | 1+0t | 0 | 0 | 0 |  |
| list_lucode_tmux_servers | ListLucodeTmuxServers | 1+0t | 0 | 0 | 0 |  |
| list_open_app_catalog | ListOpenAppCatalog | 2+0t | 0 | 5 | 0 |  |
| list_project_branches | ListProjectBranches | 3+0t | 0 | 5 | 0 |  |
| lucode_project_workflow_defaults_delete | LucodeProjectWorkflowDefaultsDelete | 1+0t | 0 | 0 | 0 |  |
| lucode_project_workflow_defaults_get | LucodeProjectWorkflowDefaultsGet | 1+0t | 0 | 0 | 0 |  |
| lucode_project_workflow_defaults_set | LucodeProjectWorkflowDefaultsSet | 1+0t | 0 | 0 | 0 |  |
| lucode_task_advance_stage | LucodeTaskAdvanceStage | 1+0t | 0 | 0 | 0 |  |
| lucode_task_artifact_history | LucodeTaskArtifactHistory | 1+0t | 0 | 0 | 0 |  |
| lucode_task_attach_issue | LucodeTaskAttachIssue | 1+0t | 0 | 0 | 0 |  |
| lucode_task_attach_pr | LucodeTaskAttachPr | 1+0t | 0 | 0 | 0 |  |
| lucode_task_cancel | LucodeTaskCancel | 1+0t | 0 | 0 | 0 |  |
| lucode_task_confirm_stage | LucodeTaskConfirmStage | 1+0t | 0 | 0 | 0 |  |
| lucode_task_create | LucodeTaskCreate | 1+0t | 0 | 0 | 0 |  |
| lucode_task_delete | LucodeTaskDelete | 1+0t | 0 | 0 | 0 |  |
| lucode_task_get | LucodeTaskGet | 1+0t | 0 | 0 | 0 |  |
| lucode_task_list | LucodeTaskList | 1+0t | 0 | 0 | 0 |  |
| lucode_task_list_stage_configs | LucodeTaskListStageConfigs | 1+0t | 0 | 0 | 0 |  |
| lucode_task_promote_to_ready | LucodeTaskPromoteToReady | 1+0t | 0 | 0 | 0 |  |
| lucode_task_reopen | LucodeTaskReopen | 1+0t | 0 | 0 | 0 |  |
| lucode_task_run_cancel | LucodeTaskRunCancel | 1+0t | 0 | 0 | 0 |  |
| lucode_task_run_done | LucodeTaskRunDone | 1+0t | 0 | 0 | 1 | mcp_api(1) |
| lucode_task_run_get | LucodeTaskRunGet | 1+0t | 0 | 0 | 0 |  |
| lucode_task_run_list | LucodeTaskRunList | 1+0t | 0 | 0 | 0 |  |
| lucode_task_set_stage_config | LucodeTaskSetStageConfig | 1+0t | 0 | 0 | 0 |  |
| lucode_task_start_clarify_run | LucodeTaskStartClarifyRun | 1+0t | 0 | 0 | 0 |  |
| lucode_task_start_stage_run | LucodeTaskStartStageRun | 1+0t | 0 | 0 | 0 |  |
| lucode_task_update_content | LucodeTaskUpdateContent | 1+0t | 0 | 0 | 0 |  |
| open_documents_privacy_settings | OpenDocumentsPrivacySettings | 1+0t | 0 | 1 | 0 |  |
| open_external_url | OpenExternalUrl | 9+0t | 0 | 4 | 0 |  |
| open_in_app | OpenInApp | 5+0t | 0 | 19 | 0 |  |
| open_in_vscode | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| paste_and_submit_terminal | PasteAndSubmitTerminal | 8+0t | 0 | 14 | 0 |  |
| path_exists | PathExists | 6+0t | 0 | 21 | 0 |  |
| preview_disable_element_picker | PreviewDisableElementPicker | 1+0t | 0 | 0 | 0 |  |
| preview_enable_element_picker | PreviewEnableElementPicker | 1+0t | 0 | 0 | 0 |  |
| preview_eval_script | PreviewEvalScript | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| preview_poll_picked_element | PreviewPollPickedElement | 1+0t | 0 | 0 | 0 |  |
| pty_ack | PtyAck | 1+0t | 0 | 1 | 0 |  |
| pty_kill | PtyKill | 1+0t | 0 | 2 | 0 |  |
| pty_resize | PtyResize | 1+0t | 0 | 1 | 0 |  |
| pty_spawn | PtySpawn | 1+0t | 0 | 2 | 0 |  |
| pty_subscribe | PtySubscribe | 1+0t | 0 | 0 | 0 |  |
| pty_write | PtyWrite | 1+0t | 0 | 1 | 0 |  |
| read_diff_image | ReadDiffImage | 1+0t | 0 | 8 | 0 |  |
| read_project_file | ReadProjectFile | 1+0t | 0 | 1 | 0 |  |
| refresh_agent_binary_detection | RefreshAgentBinaryDetection | 2+0t | 0 | 1 | 0 |  |
| refresh_terminal_view | RefreshTerminalView | 1+0t | 0 | 3 | 0 |  |
| register_session_terminals | RegisterSessionTerminals | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| remove_mcp_for_project | RemoveMcpForProject | 1+0t | 0 | 0 | 0 |  |
| remove_recent_project | RemoveRecentProject | 3+0t | 0 | 3 | 0 |  |
| report_attention_snapshot | ReportAttentionSnapshot | 1+0t | 0 | 0 | 0 |  |
| repository_is_empty | RepositoryIsEmpty | 1+0t | 0 | 2 | 0 |  |
| reset_contextual_actions_to_defaults | ResetContextualActionsToDefaults | 1+0t | 0 | 1 | 0 |  |
| reset_folder_permissions | ResetFolderPermissions | 1+0t | 0 | 1 | 0 |  |
| reset_project_action_buttons_to_defaults | ResetProjectActionButtonsToDefaults | 1+0t | 0 | 4 | 0 |  |
| resize_terminal | ResizeTerminal | 1+0t | 0 | 7 | 0 |  |
| restart_app | RestartApp | 1+0t | 0 | 0 | 0 |  |
| restart_session_terminals | RestartSessionTerminals | 1+0t | 0 | 0 | 0 |  |
| resume_session_terminals | ResumeSessionTerminals | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| save_open_tabs_state | SaveOpenTabsState | 2+0t | 0 | 1 | 0 |  |
| schaltwerk_core_append_spec_content | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_archive_spec_session | SchaltwerkCoreArchiveSpecSession | 1+0t | 0 | 5 | 0 |  |
| schaltwerk_core_cancel_session | SchaltwerkCoreCancelSession | 3+0t | 0 | 16 | 2 | mcp_api(2) |
| schaltwerk_core_cleanup_orphaned_worktrees | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_clear_spec_review_comments | SchaltwerkCoreClearSpecReviewComments | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_clone_project | SchaltwerkCoreCloneProject | 1+0t | 0 | 4 | 0 |  |
| schaltwerk_core_confirm_consolidation_winner | SchaltwerkCoreConfirmConsolidationWinner | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_convert_session_to_draft | SchaltwerkCoreConvertSessionToDraft | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_convert_version_group_to_spec | SchaltwerkCoreConvertVersionGroupToSpec | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_create_epic | SchaltwerkCoreCreateEpic | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_create_session | SchaltwerkCoreCreateSession | 0+0t | 0 | 1 | 0 | mock/assertion only |
| schaltwerk_core_create_spec_session | SchaltwerkCoreCreateSpecSession | 2+0t | 0 | 3 | 0 |  |
| schaltwerk_core_delete_archived_spec | SchaltwerkCoreDeleteArchivedSpec | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_delete_epic | SchaltwerkCoreDeleteEpic | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_discard_file_in_orchestrator | SchaltwerkCoreDiscardFileInOrchestrator | 2+0t | 0 | 1 | 0 |  |
| schaltwerk_core_discard_file_in_session | SchaltwerkCoreDiscardFileInSession | 2+0t | 0 | 1 | 0 |  |
| schaltwerk_core_force_cancel_session | SchaltwerkCoreForceCancelSession | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_generate_commit_message | SchaltwerkCoreGenerateCommitMessage | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_generate_session_name | SchaltwerkCoreGenerateSessionName | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_get_agent_type | SchaltwerkCoreGetAgentType | 2+0t | 0 | 0 | 0 |  |
| schaltwerk_core_get_archive_max_entries | SchaltwerkCoreGetArchiveMaxEntries | 1+0t | 0 | 5 | 0 |  |
| schaltwerk_core_get_consolidation_default_favorite | SchaltwerkCoreGetConsolidationDefaultFavorite | 1+0t | 0 | 5 | 0 |  |
| schaltwerk_core_get_consolidation_stats | SchaltwerkCoreGetConsolidationStats | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_get_font_sizes | SchaltwerkCoreGetFontSizes | 1+0t | 0 | 7 | 0 |  |
| schaltwerk_core_get_language | SchaltwerkCoreGetLanguage | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_get_merge_preview | SchaltwerkCoreGetMergePreview | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_get_merge_preview_with_worktree | SchaltwerkCoreGetMergePreviewWithWorktree | 2+0t | 0 | 4 | 0 |  |
| schaltwerk_core_get_orchestrator_agent_type | SchaltwerkCoreGetOrchestratorAgentType | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_get_session | SchaltwerkCoreGetSession | 8+0t | 0 | 50 | 0 |  |
| schaltwerk_core_get_session_agent_content | SchaltwerkCoreGetSessionAgentContent | 5+0t | 0 | 7 | 0 |  |
| schaltwerk_core_get_spec | SchaltwerkCoreGetSpec | 3+0t | 0 | 6 | 0 |  |
| schaltwerk_core_get_spec_clarification_agent_type | SchaltwerkCoreGetSpecClarificationAgentType | 1+0t | 0 | 4 | 0 |  |
| schaltwerk_core_get_theme | SchaltwerkCoreGetTheme | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_has_uncommitted_changes | SchaltwerkCoreHasUncommittedChanges | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_link_session_to_issue | SchaltwerkCoreLinkSessionToIssue | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_link_session_to_pr | SchaltwerkCoreLinkSessionToPr | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_list_archived_specs | SchaltwerkCoreListArchivedSpecs | 1+0t | 0 | 5 | 0 |  |
| schaltwerk_core_list_codex_models | SchaltwerkCoreListCodexModels | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_list_enriched_sessions | SchaltwerkCoreListEnrichedSessions | 1+0t | 0 | 57 | 0 |  |
| schaltwerk_core_list_enriched_sessions_sorted | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_list_epics | SchaltwerkCoreListEpics | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_list_project_files | SchaltwerkCoreListProjectFiles | 2+0t | 0 | 2 | 0 |  |
| schaltwerk_core_list_sessions | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_list_sessions_by_state | SchaltwerkCoreListSessionsByState | 0+0t | 0 | 50 | 0 | mock/assertion only |
| schaltwerk_core_list_spec_review_comments | SchaltwerkCoreListSpecReviewComments | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_log_frontend_message | SchaltwerkCoreLogFrontendMessage | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_merge_session_to_main | SchaltwerkCoreMergeSessionToMain | 1+0t | 0 | 4 | 0 |  |
| schaltwerk_core_rename_draft_session | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_rename_session_display_name | SchaltwerkCoreRenameSessionDisplayName | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_rename_version_group | SchaltwerkCoreRenameVersionGroup | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_reset_orchestrator | SchaltwerkCoreResetOrchestrator | 1+0t | 0 | 4 | 0 |  |
| schaltwerk_core_reset_session_worktree | SchaltwerkCoreResetSessionWorktree | 3+0t | 0 | 8 | 0 |  |
| schaltwerk_core_reset_spec_orchestrator | SchaltwerkCoreResetSpecOrchestrator | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_restore_archived_spec | SchaltwerkCoreRestoreArchivedSpec | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_save_spec_review_comments | SchaltwerkCoreSaveSpecReviewComments | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_set_agent_type | SchaltwerkCoreSetAgentType | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_set_archive_max_entries | SchaltwerkCoreSetArchiveMaxEntries | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_set_consolidation_default_favorite | SchaltwerkCoreSetConsolidationDefaultFavorite | 1+0t | 0 | 5 | 0 |  |
| schaltwerk_core_set_font_sizes | SchaltwerkCoreSetFontSizes | 1+0t | 0 | 3 | 0 |  |
| schaltwerk_core_set_item_epic | SchaltwerkCoreSetItemEpic | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_set_language | SchaltwerkCoreSetLanguage | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_set_orchestrator_agent_type | SchaltwerkCoreSetOrchestratorAgentType | 2+0t | 0 | 2 | 0 |  |
| schaltwerk_core_set_session_agent_type | SchaltwerkCoreSetSessionAgentType | 1+0t | 0 | 1 | 0 |  |
| schaltwerk_core_set_spec_attention_required | SchaltwerkCoreSetSpecAttentionRequired | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_set_spec_clarification_agent_type | SchaltwerkCoreSetSpecClarificationAgentType | 1+0t | 0 | 3 | 0 |  |
| schaltwerk_core_set_spec_stage | SchaltwerkCoreSetSpecStage | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_set_theme | SchaltwerkCoreSetTheme | 1+0t | 0 | 4 | 0 |  |
| schaltwerk_core_start_claude | SchaltwerkCoreStartClaude | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_start_claude_orchestrator | SchaltwerkCoreStartClaudeOrchestrator | 2+0t | 1 | 10 | 3 | mcp_api(3) |
| schaltwerk_core_start_claude_with_restart | SchaltwerkCoreStartClaudeWithRestart | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_start_fresh_orchestrator | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_start_improve_plan_round | SchaltwerkCoreStartImprovePlanRound | 1+0t | 0 | 2 | 0 |  |
| schaltwerk_core_start_session_agent | SchaltwerkCoreStartSessionAgent | 1+0t | 1 | 5 | 0 |  |
| schaltwerk_core_start_session_agent_with_restart | SchaltwerkCoreStartSessionAgentWithRestart | 3+0t | 1 | 12 | 4 | mcp_api(4) |
| schaltwerk_core_start_spec_orchestrator | SchaltwerkCoreStartSpecOrchestrator | 0+0t | 1 | 0 | 0 |  |
| schaltwerk_core_submit_spec_clarification_prompt | SchaltwerkCoreSubmitSpecClarificationPrompt | 2+0t | 0 | 9 | 0 |  |
| schaltwerk_core_trigger_consolidation_judge | SchaltwerkCoreTriggerConsolidationJudge | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_unlink_session_from_issue | SchaltwerkCoreUnlinkSessionFromIssue | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_unlink_session_from_pr | SchaltwerkCoreUnlinkSessionFromPr | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_update_consolidation_outcome_vertical | SchaltwerkCoreUpdateConsolidationOutcomeVertical | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| schaltwerk_core_update_epic | SchaltwerkCoreUpdateEpic | 1+0t | 0 | 0 | 0 |  |
| schaltwerk_core_update_git_stats | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| schaltwerk_core_update_session_from_parent | SchaltwerkCoreUpdateSessionFromParent | 2+0t | 0 | 3 | 0 |  |
| schaltwerk_core_update_spec_content | SchaltwerkCoreUpdateSpecContent | 2+0t | 0 | 13 | 0 |  |
| session_get_autofix | SessionGetAutofix | 1+0t | 0 | 0 | 0 |  |
| session_set_autofix | SessionSetAutofix | 1+0t | 0 | 0 | 0 |  |
| session_try_autofix | SessionTryAutofix | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| set_agent_binary_path | SetAgentBinaryPath | 2+0t | 0 | 0 | 0 |  |
| set_agent_cli_args | SetAgentCliArgs | 1+0t | 0 | 7 | 0 |  |
| set_agent_command_prefix | SetAgentCommandPrefix | 1+0t | 0 | 0 | 0 |  |
| set_agent_env_vars | SetAgentEnvVars | 1+0t | 0 | 9 | 0 |  |
| set_agent_initial_command | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| set_agent_preferences | SetAgentPreferences | 1+0t | 0 | 5 | 0 |  |
| set_agent_presets | SetAgentPresets | 0+0t | 1 | 2 | 0 |  |
| set_agent_variants | SetAgentVariants | 0+0t | 1 | 2 | 0 |  |
| set_amp_mcp_servers | SetAmpMcpServers | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| set_contextual_actions | SetContextualActions | 0+0t | 1 | 3 | 0 |  |
| set_default_open_app | SetDefaultOpenApp | 2+0t | 0 | 2 | 0 |  |
| set_dev_error_toasts_enabled | SetDevErrorToastsEnabled | 1+0t | 0 | 2 | 0 |  |
| set_diff_view_preferences | SetDiffViewPreferences | 2+0t | 0 | 17 | 0 |  |
| set_editor_overrides | SetEditorOverrides | 1+0t | 0 | 0 | 0 |  |
| set_enabled_agents | SetEnabledAgents | 2+0t | 0 | 1 | 0 |  |
| set_enabled_open_app_ids | SetEnabledOpenAppIds | 1+0t | 0 | 2 | 0 |  |
| set_favorite_order | SetFavoriteOrder | 1+0t | 0 | 1 | 0 |  |
| set_generation_settings | SetGenerationSettings | 1+0t | 0 | 5 | 0 |  |
| set_keyboard_shortcuts | SetKeyboardShortcuts | 1+0t | 0 | 1 | 0 |  |
| set_last_project_parent_directory | SetLastProjectParentDirectory | 3+0t | 0 | 18 | 0 |  |
| set_project_action_buttons | SetProjectActionButtons | 1+0t | 0 | 1 | 0 |  |
| set_project_agent_plugin_config | SetProjectAgentPluginConfig | 1+0t | 0 | 3 | 0 |  |
| set_project_default_base_branch | SetProjectDefaultBaseBranch | 1+0t | 0 | 3 | 0 |  |
| set_project_environment_variables | SetProjectEnvironmentVariables | 1+0t | 0 | 2 | 0 |  |
| set_project_merge_preferences | SetProjectMergePreferences | 3+0t | 0 | 4 | 0 |  |
| set_project_run_script | SetProjectRunScript | 1+0t | 0 | 0 | 0 |  |
| set_project_sessions_settings | SetProjectSessionsSettings | 1+0t | 0 | 13 | 0 |  |
| set_project_settings | SetProjectSettings | 2+0t | 0 | 9 | 0 |  |
| set_raw_agent_order | SetRawAgentOrder | 1+0t | 0 | 3 | 0 |  |
| set_restore_open_projects | SetRestoreOpenProjects | 1+0t | 0 | 0 | 0 |  |
| set_session_diff_base_branch | SetSessionDiffBaseBranch | 2+0t | 0 | 0 | 0 |  |
| set_session_preferences | SetSessionPreferences | 1+0t | 0 | 0 | 0 |  |
| set_terminal_collapsed | SetTerminalCollapsed | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| set_terminal_divider_position | SetTerminalDividerPosition | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| set_terminal_settings | SetTerminalSettings | 1+0t | 0 | 2 | 0 |  |
| set_tutorial_completed | SetTutorialCompleted | 2+0t | 0 | 1 | 0 |  |
| set_visible_session | SetVisibleSession | 1+0t | 0 | 0 | 0 |  |
| start_file_watcher | StartFileWatcher | 1+0t | 0 | 11 | 0 |  |
| start_mcp_server | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| stop_file_watcher | StopFileWatcher | 4+0t | 0 | 10 | 0 |  |
| suspend_session_terminals | SuspendSessionTerminals | 0+0t | 0 | 0 | 0 | zero refs anywhere |
| terminal_exists | TerminalExists | 4+0t | 0 | 37 | 0 |  |
| terminals_exist_bulk | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| trigger_folder_permission_request | - | 0+0t | 0 | 0 | 0 | NOT IN ENUM; zero refs anywhere |
| update_recent_project_timestamp | UpdateRecentProjectTimestamp | 1+0t | 0 | 1 | 0 |  |
| write_terminal | WriteTerminal | 3+0t | 0 | 8 | 0 |  |

## 3. Retire Candidates (zero callers anywhere)

54 registered Tauri commands have **zero invoke sites in the frontend, zero references via wrapper bindings, and zero references in `mcp_api.rs`**. Of these:

- 24 are not in the frontend enum at all (so they cannot be invoked from the frontend by definition)
- 30 are in the enum but the enum entry has no caller

### 3a. Backend-registered AND in enum AND zero callers (30)

Likely candidates for retirement together with the enum entry. Each of these would runtime-error if a typo elsewhere ever invoked them.

| Command | Enum entry | Likely reason |
|---|---|---|
| `clipboard_read_text` | (no — phantom) | _phantom; see §4_ |
| `get_amp_mcp_servers` | `GetAmpMcpServers` | Amp MCP wiring rolled into unified flow |
| `get_enabled_open_app_ids` | `GetEnabledOpenAppIds` | replaced by `list_available_open_apps` etc. |
| `get_terminal_backlog` | `GetTerminalBacklog` | _phantom; see §4_ |
| `get_terminal_ui_preferences` | `GetTerminalUiPreferences` | unused settings panel surface |
| `github_create_session_pr` | `GitHubCreateSessionPr` | superseded by `forge_create_session_pr` (registered Phase 7 unified-forge) |
| `github_preview_pr` | `GitHubPreviewPr` | superseded by forge surface |
| `gitlab_approve_mr` | `GitLabApproveMr` | superseded by `forge_approve_pr` |
| `gitlab_comment_on_mr` | `GitLabCommentOnMr` | superseded by `forge_comment_on_pr` |
| `gitlab_create_mr` | `GitLabCreateMr` | superseded |
| `gitlab_create_session_mr` | `GitLabCreateSessionMr` | reused via `mcp_api.rs` (REST path) — keep the function, retire the Tauri-decoration only if no frontend ever calls it |
| `gitlab_merge_mr` | `GitLabMergeMr` | superseded by `forge_merge_pr` |
| `preview_eval_script` | `PreviewEvalScript` | preview picker pivot dropped script eval surface |
| `register_session_terminals` | `RegisterSessionTerminals` | replaced by lazy terminal creation flow |
| `resume_session_terminals` | `ResumeSessionTerminals` | session-suspend feature appears unwired |
| `schaltwerk_core_confirm_consolidation_winner` | `SchaltwerkCoreConfirmConsolidationWinner` | consolidation flow now driven by REST `lucode_confirm_consolidation_winner` |
| `schaltwerk_core_generate_session_name` | `SchaltwerkCoreGenerateSessionName` | unwired (likely never landed in UI) |
| `schaltwerk_core_get_merge_preview` | `SchaltwerkCoreGetMergePreview` | superseded by `..._with_worktree` variant |
| `schaltwerk_core_has_uncommitted_changes` | `SchaltwerkCoreHasUncommittedChanges` | replaced by event-driven model |
| `schaltwerk_core_link_session_to_issue` | `SchaltwerkCoreLinkSessionToIssue` | linking flow moved to forge layer |
| `schaltwerk_core_rename_session_display_name` | `SchaltwerkCoreRenameSessionDisplayName` | unwired |
| `schaltwerk_core_rename_version_group` | `SchaltwerkCoreRenameVersionGroup` | unwired |
| `schaltwerk_core_set_spec_attention_required` | `SchaltwerkCoreSetSpecAttentionRequired` | task-flow v2 owns attention via `lucode_task_*`; legacy schaltwerk surface unwired |
| `schaltwerk_core_start_claude` | `SchaltwerkCoreStartClaude` | superseded by `..._start_session_agent` |
| `schaltwerk_core_start_claude_with_restart` | `SchaltwerkCoreStartClaudeWithRestart` | superseded by `..._start_session_agent_with_restart` |
| `schaltwerk_core_trigger_consolidation_judge` | `SchaltwerkCoreTriggerConsolidationJudge` | judge triggered via REST API path |
| `schaltwerk_core_unlink_session_from_issue` | `SchaltwerkCoreUnlinkSessionFromIssue` | linking flow moved to forge layer |
| `schaltwerk_core_update_consolidation_outcome_vertical` | `SchaltwerkCoreUpdateConsolidationOutcomeVertical` | vertical-outcome surface superseded |
| `session_try_autofix` | `SessionTryAutofix` | autofix surface unwired (only `session_set_autofix`/`session_get_autofix` used) |
| `set_amp_mcp_servers` | `SetAmpMcpServers` | mirror of `get_amp_mcp_servers` |
| `set_terminal_collapsed` | `SetTerminalCollapsed` | terminal collapse persisted via different path |
| `set_terminal_divider_position` | `SetTerminalDividerPosition` | divider persisted via different path |
| `suspend_session_terminals` | `SuspendSessionTerminals` | mirror of `resume_session_terminals` |
| `terminal_acknowledge_output` | (no — phantom) | _phantom; see §4_ |

### 3b. Backend-registered AND NOT in enum AND zero callers (24)

These are not even named in the frontend enum. They must be either:
- legitimate registrations awaiting wire-up (verify before retiring), or
- straight dead code from earlier refactors.

| Command | Likely reason |
|---|---|
| `detect_agent_binaries` | `detect_all_agent_binaries` is the wired variant |
| `detect_all_agent_binaries` | wired, but enum entry was never added (frontend uses different code path) — verify |
| `get_active_file_watchers` | watcher inspection unused in UI |
| `get_agent_initial_command` | initial-command surface superseded |
| `get_all_terminal_activity` | per-terminal activity used instead |
| `get_commit_file_contents` | git history shows files via different pipeline |
| `get_commit_files` | same |
| `get_effective_agent_binary_path` | `get_agent_binary_config` covers UI need |
| `get_git_history` | superseded by `get_git_graph_history` |
| `get_terminal_activity_status` | superseded by `report_attention_snapshot` |
| `github_get_pr_feedback` | `mcp_api.rs` calls `github_get_pr_feedback_impl` directly; the Tauri-decorated wrapper is unreachable |
| `is_file_watcher_active` | watcher inspection unused |
| `open_in_vscode` | superseded by `open_in_app` |
| `schaltwerk_core_append_spec_content` | spec edit moved to `update_spec_content` |
| `schaltwerk_core_cleanup_orphaned_worktrees` | cleanup automatic; no manual UI |
| `schaltwerk_core_list_enriched_sessions_sorted` | superseded by `..._list_enriched_sessions` (single sort path on backend) |
| `schaltwerk_core_list_sessions` | superseded by `..._list_enriched_sessions` |
| `schaltwerk_core_rename_draft_session` | rename moved to `..._rename_session_display_name` (which is itself unwired — see 3a) |
| `schaltwerk_core_start_fresh_orchestrator` | fresh-orchestrator path superseded |
| `schaltwerk_core_update_git_stats` | git-stats refresh now event-driven |
| `set_agent_initial_command` | mirror of `get_agent_initial_command` |
| `start_mcp_server` | MCP server lifecycle internal; never called from UI |
| `terminals_exist_bulk` | UI uses `terminal_exists` per-id |
| `trigger_folder_permission_request` | wrapped by `ensure_folder_permission` (which IS used) |

## 4. Phantom Enum Entries

Frontend enum entries pointing at non-existent backend commands. Any caller would runtime-error.

| Enum key | String value | Notes |
|---|---|---|
| `ClipboardReadText` | `clipboard_read_text` | not registered; only `clipboard_write_text` exists |
| `GetTerminalBacklog` | `get_terminal_backlog` | no backend command; unused in src/ as well |
| `SchaltwerkTerminalAcknowledgeOutput` | `terminal_acknowledge_output` | no backend command |

All three currently have **zero callers** in `src/`, so they would runtime-error only if invoked. They should be deleted from `tauriCommands.ts` post-merge.

## 5. Test-Only / Mock-Only Commands (flagged for review)

### 5a. Mock-only (referenced only inside test files; never invoked even from tests)
These have a `case TauriCommands.X:` or assertion in tests, but no production or test code calls `invoke(...)` for them. They are dormant defensive scaffolding.

| Command | Enum entry | Test mock refs | Note |
|---|---|---|---|
| `schaltwerk_core_create_session` | `SchaltwerkCoreCreateSession` | 1 | only `expect(mockInvoke).not.toHaveBeenCalledWith(...)` (negative assertion) in `sessionVersions.test.ts:640` — flag the assertion + retire |
| `schaltwerk_core_list_sessions_by_state` | `SchaltwerkCoreListSessionsByState` | ~50 | scattered across mock `invoke` switch arms — production replaced by `..._list_enriched_sessions` |

### 5b. Test-only invokes (commands invoked only from tests)
None.

## 6. Surprises

1. **Duplicate `#[tauri::command]` decorations on dead `shared/permissions.rs`.** `src-tauri/src/shared/permissions.rs` (lines 4, 25, 59) decorates `check_folder_access`, `trigger_folder_permission_request`, and `ensure_folder_permission` with `#[tauri::command]`, but `main.rs` only registers the bin-local `permissions::*` versions. The library copies are dead at the Tauri boundary AND nothing imports them as regular Rust functions (`grep` for `lucode::shared::permissions::` in `src-tauri/` returns zero hits). The `#[tauri::command]` macros there are pure dead code — and three of these symbol names duplicate the registered `permissions::*` ones, which is exactly the failure mode the consolidation feedback flagged ("legacy duplicates merged via scout rule").
2. **`open_apps::list_available_open_apps` decorated but used as a plain fn fallback.** `main.rs:341` defines its own `list_available_open_apps` (the registered one), which on DB failure calls `lucode::open_apps::list_available_open_apps()` (open_apps.rs:1427) as a regular async fn — yet that fallback fn is also `#[tauri::command]`-decorated even though it's not in the handler list. Decoration is wasteful (no harm beyond noise).
3. **Unified-forge migration left both surfaces registered.** All 5 `gitlab_*_mr` write commands and 2 `github_*_pr` commands have zero frontend callers; the frontend has fully migrated to `forge_*`. The `gitlab_*` block's "TODO: remove after frontend migration to forge_* commands" comment in `main.rs:1490` is now actionable. Note `gitlab_create_session_mr` is still called from `mcp_api.rs:8676` — keep the underlying Rust fn, just retire the Tauri registration.
4. **`schaltwerk_core_list_sessions_by_state` is a hot-path-looking mock fixture with zero production reach.** ~50 test mock cases pretend it exists; production code replaced it with `..._list_enriched_sessions` long ago. Risk: a future test could invoke through the mock harness and accidentally load real bindings; nothing catches it. Safe to retire from both the registered list and the enum.
5. **Phantom enum entries in `tauriCommands.ts` predate any TypeScript-level guard.** Per CLAUDE.md, the enum is the single source of truth, but `clipboard_read_text`, `get_terminal_backlog`, and `terminal_acknowledge_output` exist in the enum with no backend counterpart. Suggest a build-time check that the enum's value set is a subset of the registered handler set.

## Recommendations

**Do not retire pre-merge.** This audit's purpose is to map the surface for the post-merge cleanup pass.

Post-merge, in order of confidence:

1. **High confidence — pure dead Tauri-decoration cleanup (no functional change):**
   - Remove `#[tauri::command]` from `src-tauri/src/shared/permissions.rs` lines 4, 25, 59 (the wrappers and shared file are import-dead too; consider deleting `shared/permissions.rs` outright after a final import sweep).
   - Remove `#[tauri::command]` from `src-tauri/src/open_apps.rs:1427` (`list_available_open_apps`); the bin-local one in `main.rs:341` is registered.

2. **Medium confidence — phantom enum cleanup (frontend-only):**
   - Delete `ClipboardReadText`, `GetTerminalBacklog`, `SchaltwerkTerminalAcknowledgeOutput` from `src/common/tauriCommands.ts`.

3. **Medium confidence — superseded-by-forge cleanup:**
   - Backend (handler block + impls): `gitlab_approve_mr`, `gitlab_comment_on_mr`, `gitlab_create_mr`, `gitlab_merge_mr`, `github_create_session_pr`, `github_preview_pr`. Keep `gitlab_create_session_mr` (used by mcp_api.rs) and `github_get_pr_feedback_impl` (used by mcp_api.rs); retire only the Tauri command registration for those, not the Rust functions.
   - Enum: drop the matching `GitLab*` and `GitHub*Pr` entries flagged in §3a.

4. **Medium confidence — superseded-by-internal commands:**
   - `schaltwerk_core_list_sessions`, `schaltwerk_core_list_enriched_sessions_sorted`, `schaltwerk_core_get_merge_preview` (use `..._with_worktree`), `schaltwerk_core_has_uncommitted_changes`, `schaltwerk_core_start_claude`, `schaltwerk_core_start_claude_with_restart`, `schaltwerk_core_start_fresh_orchestrator`, `schaltwerk_core_list_sessions_by_state`, `schaltwerk_core_create_session` (mock-only).

5. **Lower confidence — verify with feature owners before retiring:**
   - Consolidation: `schaltwerk_core_confirm_consolidation_winner`, `schaltwerk_core_trigger_consolidation_judge`, `schaltwerk_core_update_consolidation_outcome_vertical`. These may be intentionally kept around for a near-term re-wiring; consolidation REST flow is the current path.
   - Linking: `schaltwerk_core_link_session_to_issue`, `schaltwerk_core_unlink_session_from_issue`. May resurface when issue-linking lands in UI.
   - Terminal lifecycle: `register_session_terminals`, `suspend_session_terminals`, `resume_session_terminals`, `set_terminal_collapsed`, `set_terminal_divider_position`. These look like a partly-landed terminal-state-persistence feature.
   - Watcher inspection: `get_active_file_watchers`, `is_file_watcher_active`. Possibly debug-only utilities.
   - Misc: `session_try_autofix`, `schaltwerk_core_generate_session_name`, `schaltwerk_core_rename_version_group`, `schaltwerk_core_rename_session_display_name`, `schaltwerk_core_rename_draft_session`, `schaltwerk_core_set_spec_attention_required`, `schaltwerk_core_append_spec_content`, `schaltwerk_core_cleanup_orphaned_worktrees`, `schaltwerk_core_update_git_stats`, `get_terminal_activity_status`, `get_all_terminal_activity`, `get_agent_initial_command`/`set_agent_initial_command`, `get_effective_agent_binary_path`, `get_amp_mcp_servers`/`set_amp_mcp_servers`, `get_enabled_open_app_ids`, `get_terminal_ui_preferences`, `preview_eval_script`, `terminals_exist_bulk`, `start_mcp_server`, `open_in_vscode`, `get_commit_files`, `get_commit_file_contents`, `get_git_history`, `detect_agent_binaries`, `detect_all_agent_binaries`, `trigger_folder_permission_request`, `github_get_pr_feedback`.

6. **Process safeguard for going forward:**
   - Add a `cargo test`-level check (or a `knip`-style script) that the set of `tauri::generate_handler!` registrations is exactly the set of `#[tauri::command]`-decorated functions visible to the bin crate, AND that every value in `TauriCommands` matches a registered command. The phantom enum entries and the dead `shared/permissions.rs` decorations would have been caught at PR time.

