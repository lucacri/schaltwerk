use crate::binary_detector::DetectedBinary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum McpServerConfig {
    Local {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
    },
    Remote {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentCliArgs {
    pub claude: String,
    #[serde(default)]
    pub copilot: String,
    pub opencode: String,
    pub gemini: String,
    pub codex: String,
    pub droid: String,
    pub qwen: String,
    #[serde(default)]
    pub amp: String,
    #[serde(default)]
    pub kilocode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentInitialCommands {
    pub claude: String,
    #[serde(default)]
    pub copilot: String,
    pub opencode: String,
    pub gemini: String,
    pub codex: String,
    pub droid: String,
    pub qwen: String,
    #[serde(default)]
    pub amp: String,
    #[serde(default)]
    pub kilocode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentEnvVars {
    pub claude: HashMap<String, String>,
    #[serde(default)]
    pub copilot: HashMap<String, String>,
    pub opencode: HashMap<String, String>,
    pub gemini: HashMap<String, String>,
    pub codex: HashMap<String, String>,
    pub droid: HashMap<String, String>,
    pub qwen: HashMap<String, String>,
    #[serde(default)]
    pub amp: HashMap<String, String>,
    #[serde(default)]
    pub kilocode: HashMap<String, String>,
    pub terminal: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct AgentPreference {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct EnabledAgents {
    #[serde(default = "default_true")]
    pub claude: bool,
    #[serde(default = "default_true")]
    pub copilot: bool,
    #[serde(default = "default_true")]
    pub opencode: bool,
    #[serde(default = "default_true")]
    pub gemini: bool,
    #[serde(default = "default_true")]
    pub codex: bool,
    #[serde(default = "default_true")]
    pub droid: bool,
    #[serde(default = "default_true")]
    pub qwen: bool,
    #[serde(default = "default_true")]
    pub amp: bool,
    #[serde(default = "default_true")]
    pub kilocode: bool,
    #[serde(default = "default_true")]
    pub terminal: bool,
}

impl Default for EnabledAgents {
    fn default() -> Self {
        Self {
            claude: true,
            copilot: true,
            opencode: true,
            gemini: true,
            codex: true,
            droid: true,
            qwen: true,
            amp: true,
            kilocode: true,
            terminal: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentPreferences {
    #[serde(default)]
    pub claude: AgentPreference,
    #[serde(default)]
    pub copilot: AgentPreference,
    #[serde(default)]
    pub opencode: AgentPreference,
    #[serde(default)]
    pub gemini: AgentPreference,
    #[serde(default)]
    pub codex: AgentPreference,
    #[serde(default)]
    pub droid: AgentPreference,
    #[serde(default)]
    pub qwen: AgentPreference,
    #[serde(default)]
    pub amp: AgentPreference,
    #[serde(default)]
    pub kilocode: AgentPreference,
    #[serde(default)]
    pub terminal: AgentPreference,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TerminalUIPreferences {
    pub is_collapsed: bool,
    pub divider_position: Option<f64>,
}

fn default_true() -> bool {
    true
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AttentionNotificationMode {
    Off,
    Dock,
    System,
    #[default]
    Both,
}

fn default_attention_mode() -> AttentionNotificationMode {
    AttentionNotificationMode::Both
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DiffLayout {
    #[default]
    Unified,
    Split,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiffViewPreferences {
    #[serde(default)]
    pub continuous_scroll: bool,
    #[serde(default = "default_true")]
    pub compact_diffs: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_true")]
    pub inline_sidebar_default: bool,
    #[serde(default)]
    pub diff_layout: DiffLayout,
}

impl Default for DiffViewPreferences {
    fn default() -> Self {
        Self {
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: default_sidebar_width(),
            inline_sidebar_default: true,
            diff_layout: DiffLayout::Unified,
        }
    }
}

fn default_sidebar_width() -> u32 {
    320
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionPreferences {
    #[serde(default)]
    pub skip_confirmation_modals: bool,
    #[serde(default)]
    pub always_show_large_diffs: bool,
    #[serde(default = "default_attention_mode")]
    pub attention_notification_mode: AttentionNotificationMode,
    #[serde(default = "default_true")]
    pub remember_idle_baseline: bool,
}

impl Default for SessionPreferences {
    fn default() -> Self {
        Self {
            skip_confirmation_modals: false,
            always_show_large_diffs: false,
            attention_notification_mode: default_attention_mode(),
            remember_idle_baseline: true,
        }
    }
}

#[cfg(test)]
mod session_preferences_tests {
    use super::*;

    #[test]
    fn defaults_to_both_attention_notification_channels() {
        assert_eq!(
            SessionPreferences::default().attention_notification_mode,
            AttentionNotificationMode::Both
        );
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GenerationSettings {
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cli_args: Option<String>,
    #[serde(default)]
    pub name_prompt: Option<String>,
    #[serde(default)]
    pub commit_prompt: Option<String>,
    #[serde(default)]
    pub consolidation_prompt: Option<String>,
    #[serde(default)]
    pub review_pr_prompt: Option<String>,
    #[serde(default)]
    pub plan_issue_prompt: Option<String>,
    #[serde(default)]
    pub issue_prompt: Option<String>,
    #[serde(default)]
    pub pr_prompt: Option<String>,
    #[serde(default)]
    pub autonomy_prompt_template: Option<String>,
    #[serde(default)]
    pub force_restart_prompt_template: Option<String>,
    #[serde(default)]
    pub plan_candidate_prompt_template: Option<String>,
    #[serde(default)]
    pub plan_judge_prompt_template: Option<String>,
    #[serde(default)]
    pub judge_prompt_template: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub shell: Option<String>,
    pub shell_args: Vec<String>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default = "default_true")]
    pub webgl_enabled: bool,
    #[serde(default = "default_true")]
    pub smooth_scrolling: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            shell: None,
            shell_args: Vec::new(),
            font_family: None,
            webgl_enabled: true,
            smooth_scrolling: true,
        }
    }
}

fn default_terminal_font_size() -> i32 {
    13
}

fn default_ui_font_size() -> i32 {
    12
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontSizes {
    #[serde(default = "default_terminal_font_size")]
    pub terminal: i32,
    #[serde(default = "default_ui_font_size")]
    pub ui: i32,
}

impl Default for FontSizes {
    fn default() -> Self {
        Self {
            terminal: default_terminal_font_size(),
            ui: default_ui_font_size(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AgentBinaryConfig {
    pub agent_name: String,
    pub custom_path: Option<String>,
    pub auto_detect: bool,
    pub detected_binaries: Vec<DetectedBinary>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentBinaryConfigs {
    pub claude: Option<AgentBinaryConfig>,
    #[serde(default)]
    pub copilot: Option<AgentBinaryConfig>,
    pub opencode: Option<AgentBinaryConfig>,
    pub gemini: Option<AgentBinaryConfig>,
    pub codex: Option<AgentBinaryConfig>,
    pub droid: Option<AgentBinaryConfig>,
    pub qwen: Option<AgentBinaryConfig>,
    #[serde(default)]
    pub amp: Option<AgentBinaryConfig>,
    #[serde(default)]
    pub kilocode: Option<AgentBinaryConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentVariant {
    pub id: String,
    pub name: String,
    pub agent_type: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub cli_args: Vec<String>,
    #[serde(default)]
    pub env_vars: HashMap<String, String>,
    #[serde(default)]
    pub is_built_in: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPresetSlot {
    pub agent_type: String,
    #[serde(default)]
    pub variant_id: Option<String>,
    #[serde(default)]
    pub autonomy_enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreset {
    pub id: String,
    pub name: String,
    pub slots: Vec<AgentPresetSlot>,
    #[serde(default)]
    pub is_built_in: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContextualActionContext {
    #[serde(alias = "mr")]
    Pr,
    Issue,
    Both,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContextualActionMode {
    Spec,
    Session,
    SpecClarify,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextualAction {
    pub id: String,
    pub name: String,
    pub context: ContextualActionContext,
    pub prompt_template: String,
    pub mode: ContextualActionMode,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub variant_id: Option<String>,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub is_built_in: bool,
}

pub fn normalize_contextual_action(action: ContextualAction) -> ContextualAction {
    ContextualAction {
        prompt_template: action
            .prompt_template
            .replace("{{mr.", "{{pr.")
            .replace("pr.headRefName", "pr.sourceBranch"),
        ..action
    }
}

#[cfg(test)]
mod contextual_action_mode_tests {
    use super::*;

    #[test]
    fn contextual_action_mode_roundtrips_for_each_variant() {
        assert_eq!(
            serde_json::to_string(&ContextualActionMode::Spec).unwrap(),
            "\"spec\""
        );
        assert_eq!(
            serde_json::to_string(&ContextualActionMode::Session).unwrap(),
            "\"session\""
        );
        assert_eq!(
            serde_json::to_string(&ContextualActionMode::SpecClarify).unwrap(),
            "\"spec-clarify\""
        );
        assert_eq!(
            serde_json::from_str::<ContextualActionMode>("\"spec\"").unwrap(),
            ContextualActionMode::Spec
        );
        assert_eq!(
            serde_json::from_str::<ContextualActionMode>("\"session\"").unwrap(),
            ContextualActionMode::Session
        );
        assert_eq!(
            serde_json::from_str::<ContextualActionMode>("\"spec-clarify\"").unwrap(),
            ContextualActionMode::SpecClarify
        );
    }
}

pub fn normalize_contextual_actions(actions: Vec<ContextualAction>) -> Vec<ContextualAction> {
    actions
        .into_iter()
        .map(normalize_contextual_action)
        .collect()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub agent_env_vars: AgentEnvVars,
    pub agent_cli_args: AgentCliArgs,
    #[serde(default)]
    pub agent_initial_commands: AgentInitialCommands,
    #[serde(default)]
    pub agent_preferences: AgentPreferences,
    #[serde(default)]
    pub enabled_agents: EnabledAgents,
    pub terminal_ui: TerminalUIPreferences,
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub font_sizes: FontSizes,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    pub agent_binaries: AgentBinaryConfigs,
    pub diff_view: DiffViewPreferences,
    pub session: SessionPreferences,
    #[serde(default)]
    pub keyboard_shortcuts: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub tutorial_completed: bool,
    #[serde(default)]
    pub amp_mcp_servers: HashMap<String, McpServerConfig>,
    #[serde(default = "default_true")]
    pub dev_error_toasts_enabled: bool,
    #[serde(default)]
    pub last_project_parent_directory: Option<String>,
    #[serde(default)]
    pub agent_command_prefix: Option<String>,
    #[serde(default)]
    pub generation: GenerationSettings,
    #[serde(default = "default_true")]
    pub restore_open_projects: bool,
    #[serde(default)]
    pub agent_variants: Vec<AgentVariant>,
    #[serde(default)]
    pub agent_presets: Vec<AgentPreset>,
    #[serde(default)]
    pub favorite_order: Vec<String>,
    #[serde(default)]
    pub raw_agent_order: Vec<String>,
    #[serde(default)]
    pub contextual_actions: Vec<ContextualAction>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            agent_env_vars: AgentEnvVars::default(),
            agent_cli_args: AgentCliArgs::default(),
            agent_initial_commands: AgentInitialCommands::default(),
            agent_preferences: AgentPreferences::default(),
            enabled_agents: EnabledAgents::default(),
            terminal_ui: TerminalUIPreferences::default(),
            terminal: TerminalSettings::default(),
            font_sizes: FontSizes::default(),
            theme: default_theme(),
            language: default_language(),
            agent_binaries: AgentBinaryConfigs::default(),
            diff_view: DiffViewPreferences::default(),
            session: SessionPreferences::default(),
            keyboard_shortcuts: HashMap::new(),
            tutorial_completed: false,
            amp_mcp_servers: HashMap::new(),
            dev_error_toasts_enabled: default_true(),
            last_project_parent_directory: None,
            agent_command_prefix: None,
            generation: GenerationSettings::default(),
            restore_open_projects: default_true(),
            agent_variants: Vec::new(),
            agent_presets: Vec::new(),
            favorite_order: Vec::new(),
            raw_agent_order: Vec::new(),
            contextual_actions: Vec::new(),
        }
    }
}
