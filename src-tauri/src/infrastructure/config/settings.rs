use crate::domains::settings::{
    AgentPreference, EnabledAgents, Settings, SettingsRepository, SettingsService,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct FileSettingsRepository {
    settings_path: PathBuf,
}

fn strip_legacy_auto_commit_setting(value: &mut Value) {
    if let Value::Object(obj) = value {
        obj.remove("autoCommitOnReview");
        obj.remove("auto_commit_on_review");

        if let Some(Value::Object(session_obj)) = obj.get_mut("session") {
            session_obj.remove("autoCommitOnReview");
            session_obj.remove("auto_commit_on_review");
        }
    }
}

impl FileSettingsRepository {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|e| format!("Failed to get config directory: {e}"))?;

        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }

        let settings_path = config_dir.join("settings.json");

        Ok(Self { settings_path })
    }
}

impl SettingsRepository for FileSettingsRepository {
    fn load(&self) -> Result<Settings, String> {
        if self.settings_path.exists() {
            let contents = fs::read_to_string(&self.settings_path)
                .map_err(|e| format!("Failed to read settings file: {e}"))?;
            let cleaned = serde_json::from_str::<Value>(&contents)
                .map(|mut value| {
                    strip_legacy_auto_commit_setting(&mut value);
                    serde_json::from_value::<Settings>(value).unwrap_or_default()
                })
                .unwrap_or_else(|_| Settings::default());

            Ok(cleaned)
        } else {
            Ok(Settings::default())
        }
    }

    fn save(&self, settings: &Settings) -> Result<(), String> {
        log::debug!("Saving settings to: {:?}", self.settings_path);

        let contents = serde_json::to_string_pretty(settings).map_err(|e| {
            let error = format!("Failed to serialize settings: {e}");
            log::error!("JSON serialization error: {error}");
            error
        })?;

        log::debug!(
            "Settings serialized to JSON, writing to file ({} bytes)",
            contents.len()
        );

        fs::write(&self.settings_path, &contents).map_err(|e| {
            let error = format!(
                "Failed to write settings file {:?}: {e}",
                self.settings_path
            );
            log::error!("File write error: {error}");
            error
        })?;

        log::debug!("Settings successfully written to disk");
        Ok(())
    }
}

pub struct SettingsManager {
    service: SettingsService,
}

impl SettingsManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let repository = Box::new(FileSettingsRepository::new(app_handle)?);
        let service = SettingsService::new(repository);

        Ok(Self { service })
    }

    pub fn get_agent_env_vars(
        &self,
        agent_type: &str,
    ) -> std::collections::HashMap<String, String> {
        self.service.get_agent_env_vars(agent_type)
    }

    pub fn set_agent_env_vars(
        &mut self,
        agent_type: &str,
        env_vars: std::collections::HashMap<String, String>,
    ) -> Result<(), String> {
        self.service
            .set_agent_env_vars(agent_type, env_vars)
            .map_err(|e| e.to_string())
    }

    pub fn get_terminal_ui_preferences(&self) -> crate::domains::settings::TerminalUIPreferences {
        self.service.get_terminal_ui_preferences()
    }

    pub fn set_terminal_collapsed(&mut self, is_collapsed: bool) -> Result<(), String> {
        self.service
            .set_terminal_collapsed(is_collapsed)
            .map_err(|e| e.to_string())
    }

    pub fn set_terminal_divider_position(&mut self, position: f64) -> Result<(), String> {
        self.service
            .set_terminal_divider_position(position)
            .map_err(|e| e.to_string())
    }

    pub fn get_font_sizes(&self) -> (i32, i32) {
        self.service.get_font_sizes()
    }

    pub fn set_font_sizes(
        &mut self,
        terminal_font_size: i32,
        ui_font_size: i32,
    ) -> Result<(), String> {
        self.service
            .set_font_sizes(terminal_font_size, ui_font_size)
            .map_err(|e| e.to_string())
    }

    pub fn get_theme(&self) -> String {
        self.service.get_theme()
    }

    pub fn set_theme(&mut self, theme: &str) -> Result<(), String> {
        self.service.set_theme(theme).map_err(|e| e.to_string())
    }

    pub fn get_language(&self) -> String {
        self.service.get_language()
    }

    pub fn set_language(&mut self, language: &str) -> Result<(), String> {
        self.service
            .set_language(language)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_cli_args(&self, agent_type: &str) -> String {
        self.service.get_agent_cli_args(agent_type)
    }

    pub fn set_agent_cli_args(&mut self, agent_type: &str, cli_args: String) -> Result<(), String> {
        self.service
            .set_agent_cli_args(agent_type, cli_args)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_initial_command(&self, agent_type: &str) -> String {
        self.service.get_agent_initial_command(agent_type)
    }

    pub fn set_agent_initial_command(
        &mut self,
        agent_type: &str,
        initial_command: String,
    ) -> Result<(), String> {
        self.service
            .set_agent_initial_command(agent_type, initial_command)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_preferences(&self, agent_type: &str) -> AgentPreference {
        self.service.get_agent_preferences(agent_type)
    }

    pub fn set_agent_preferences(
        &mut self,
        agent_type: &str,
        preferences: AgentPreference,
    ) -> Result<(), String> {
        self.service
            .set_agent_preferences(agent_type, preferences)
            .map_err(|e| e.to_string())
    }

    pub fn get_enabled_agents(&self) -> EnabledAgents {
        self.service.get_enabled_agents()
    }

    pub fn set_enabled_agents(&mut self, enabled_agents: EnabledAgents) -> Result<(), String> {
        self.service
            .set_enabled_agents(enabled_agents)
            .map_err(|e| e.to_string())
    }

    pub fn get_terminal_settings(&self) -> crate::domains::settings::TerminalSettings {
        self.service.get_terminal_settings()
    }

    pub fn set_terminal_settings(
        &mut self,
        terminal: crate::domains::settings::TerminalSettings,
    ) -> Result<(), String> {
        self.service
            .set_terminal_settings(terminal)
            .map_err(|e| e.to_string())
    }

    pub fn get_diff_view_preferences(&self) -> crate::domains::settings::DiffViewPreferences {
        self.service.get_diff_view_preferences()
    }

    pub fn set_diff_view_preferences(
        &mut self,
        preferences: crate::domains::settings::DiffViewPreferences,
    ) -> Result<(), String> {
        self.service
            .set_diff_view_preferences(preferences)
            .map_err(|e| e.to_string())
    }

    pub fn get_session_preferences(&self) -> crate::domains::settings::SessionPreferences {
        self.service.get_session_preferences()
    }

    pub fn set_session_preferences(
        &mut self,
        preferences: crate::domains::settings::SessionPreferences,
    ) -> Result<(), String> {
        self.service
            .set_session_preferences(preferences)
            .map_err(|e| e.to_string())
    }

    pub fn get_keyboard_shortcuts(&self) -> std::collections::HashMap<String, Vec<String>> {
        self.service.get_keyboard_shortcuts()
    }

    pub fn set_keyboard_shortcuts(
        &mut self,
        shortcuts: std::collections::HashMap<String, Vec<String>>,
    ) -> Result<(), String> {
        self.service
            .set_keyboard_shortcuts(shortcuts)
            .map_err(|e| e.to_string())
    }

    pub fn get_tutorial_completed(&self) -> bool {
        self.service.get_tutorial_completed()
    }

    pub fn set_tutorial_completed(&mut self, completed: bool) -> Result<(), String> {
        self.service
            .set_tutorial_completed(completed)
            .map_err(|e| e.to_string())
    }

    pub fn get_dev_error_toasts_enabled(&self) -> bool {
        self.service.get_dev_error_toasts_enabled()
    }

    pub fn set_dev_error_toasts_enabled(&mut self, enabled: bool) -> Result<(), String> {
        self.service
            .set_dev_error_toasts_enabled(enabled)
            .map_err(|e| e.to_string())
    }

    pub fn get_last_project_parent_directory(&self) -> Option<String> {
        self.service.get_last_project_parent_directory()
    }

    pub fn set_last_project_parent_directory(
        &mut self,
        directory: Option<String>,
    ) -> Result<(), String> {
        self.service
            .set_last_project_parent_directory(directory)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_binary_config(
        &self,
        agent_name: &str,
    ) -> Option<crate::domains::settings::AgentBinaryConfig> {
        self.service.get_agent_binary_config(agent_name)
    }

    pub fn set_agent_binary_config(
        &mut self,
        config: crate::domains::settings::AgentBinaryConfig,
    ) -> Result<(), String> {
        self.service
            .set_agent_binary_config(config)
            .map_err(|e| e.to_string())
    }

    pub fn get_all_agent_binary_configs(&self) -> Vec<crate::domains::settings::AgentBinaryConfig> {
        self.service.get_all_agent_binary_configs()
    }

    pub fn get_effective_binary_path(&self, agent_name: &str) -> Result<String, String> {
        self.service
            .get_effective_binary_path(agent_name)
            .map_err(|e| e.to_string())
    }

    pub fn get_amp_mcp_servers(
        &self,
    ) -> std::collections::HashMap<String, crate::domains::settings::McpServerConfig> {
        self.service.get_amp_mcp_servers()
    }

    pub fn set_amp_mcp_servers(
        &mut self,
        mcp_servers: std::collections::HashMap<String, crate::domains::settings::McpServerConfig>,
    ) -> Result<(), String> {
        self.service
            .set_amp_mcp_servers(mcp_servers)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_command_prefix(&self) -> Option<String> {
        self.service.get_agent_command_prefix()
    }

    pub fn set_agent_command_prefix(&mut self, prefix: Option<String>) -> Result<(), String> {
        self.service
            .set_agent_command_prefix(prefix)
            .map_err(|e| e.to_string())
    }

    pub fn get_generation_settings(&self) -> crate::domains::settings::GenerationSettings {
        self.service.get_generation_settings()
    }

    pub fn set_generation_settings(
        &mut self,
        settings: crate::domains::settings::GenerationSettings,
    ) -> Result<(), String> {
        self.service
            .set_generation_settings(settings)
            .map_err(|e| e.to_string())
    }

    pub fn get_contextual_actions(&self) -> Vec<crate::domains::settings::ContextualAction> {
        self.service.get_contextual_actions()
    }

    pub fn set_contextual_actions(
        &mut self,
        actions: Vec<crate::domains::settings::ContextualAction>,
    ) -> Result<(), String> {
        self.service
            .set_contextual_actions(actions)
            .map_err(|e| e.to_string())
    }

    pub fn reset_contextual_actions_to_defaults(
        &mut self,
    ) -> Result<Vec<crate::domains::settings::ContextualAction>, String> {
        self.service
            .reset_contextual_actions_to_defaults()
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_presets(&self) -> Vec<crate::domains::settings::AgentPreset> {
        self.service.get_agent_presets()
    }

    pub fn resolve_preset_first_slot_agent(&self, preset_id: &str) -> Option<String> {
        self.service.resolve_preset_first_slot_agent(preset_id)
    }

    pub fn set_agent_presets(
        &mut self,
        presets: Vec<crate::domains::settings::AgentPreset>,
    ) -> Result<(), String> {
        self.service
            .set_agent_presets(presets)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_variants(&self) -> Vec<crate::domains::settings::AgentVariant> {
        self.service.get_agent_variants()
    }

    pub fn set_agent_variants(
        &mut self,
        variants: Vec<crate::domains::settings::AgentVariant>,
    ) -> Result<(), String> {
        self.service
            .set_agent_variants(variants)
            .map_err(|e| e.to_string())
    }

    pub fn get_favorite_order(&self) -> Vec<String> {
        self.service.get_favorite_order()
    }

    pub fn set_favorite_order(&mut self, favorite_order: Vec<String>) -> Result<(), String> {
        self.service
            .set_favorite_order(favorite_order)
            .map_err(|e| e.to_string())
    }

    pub fn get_raw_agent_order(&self) -> Vec<String> {
        self.service.get_raw_agent_order()
    }

    pub fn set_raw_agent_order(&mut self, raw_agent_order: Vec<String>) -> Result<(), String> {
        self.service
            .set_raw_agent_order(raw_agent_order)
            .map_err(|e| e.to_string())
    }

    pub fn get_restore_open_projects(&self) -> bool {
        self.service.get_restore_open_projects()
    }

    pub fn set_restore_open_projects(&mut self, enabled: bool) -> Result<(), String> {
        self.service
            .set_restore_open_projects(enabled)
            .map_err(|e| e.to_string())
    }
}
