use super::types::{AgentBinaryConfig, Settings};

pub fn clean_invalid_binary_paths(settings: &mut Settings) {
    let fix_config = |config: &mut Option<AgentBinaryConfig>| {
        if let Some(cfg) = config
            && let Some(ref path) = cfg.custom_path.clone()
            && (path.ends_with(".js") || path.ends_with(".mjs"))
        {
            log::warn!(
                "Found JS file path for {}: {}, attempting to fix",
                cfg.agent_name,
                path
            );

            #[cfg(unix)]
            let possible_locations = vec![
                format!("/opt/homebrew/bin/{}", cfg.agent_name),
                format!("/usr/local/bin/{}", cfg.agent_name),
                format!("/opt/homebrew/Cellar/node/24.4.0/bin/{}", cfg.agent_name),
                format!(
                    "{}/.local/bin/{}",
                    std::env::var("HOME").unwrap_or_default(),
                    cfg.agent_name
                ),
            ];

            #[cfg(windows)]
            let possible_locations = {
                let appdata = std::env::var("APPDATA").unwrap_or_default();
                let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
                vec![
                    format!("{appdata}\\npm\\{}.cmd", cfg.agent_name),
                    format!("{localappdata}\\Microsoft\\WindowsApps\\{}.exe", cfg.agent_name),
                ]
            };

            let mut found_wrapper = None;
            for location in &possible_locations {
                if std::path::Path::new(location).exists() {
                    log::info!("Found correct binary wrapper at {location}, replacing JS path");
                    found_wrapper = Some(location.clone());
                    break;
                }
            }

            if let Some(wrapper) = found_wrapper {
                cfg.custom_path = Some(wrapper);
            } else {
                log::warn!(
                    "Could not find binary wrapper for {}, reverting to auto-detect",
                    cfg.agent_name
                );
                cfg.custom_path = None;
                cfg.auto_detect = true;
            }
        }
    };

    fix_config(&mut settings.agent_binaries.claude);
    fix_config(&mut settings.agent_binaries.copilot);
    fix_config(&mut settings.agent_binaries.opencode);
    fix_config(&mut settings.agent_binaries.gemini);
    fix_config(&mut settings.agent_binaries.codex);
    fix_config(&mut settings.agent_binaries.droid);
    fix_config(&mut settings.agent_binaries.qwen);
    fix_config(&mut settings.agent_binaries.amp);
    fix_config(&mut settings.agent_binaries.kilocode);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn missing_agent_name(agent_name: &str) -> String {
        format!("lucode-test-missing-wrapper-{agent_name}")
    }

    fn make_config(agent_name: &str, custom_path: Option<&str>) -> Option<AgentBinaryConfig> {
        Some(AgentBinaryConfig {
            agent_name: agent_name.to_string(),
            custom_path: custom_path.map(|p| p.to_string()),
            auto_detect: false,
            detected_binaries: Vec::new(),
        })
    }

    #[test]
    fn leaves_non_js_paths_untouched() {
        let mut settings = Settings::default();
        settings.agent_binaries.claude = make_config("claude", Some("/usr/local/bin/claude"));

        clean_invalid_binary_paths(&mut settings);

        let cfg = settings.agent_binaries.claude.unwrap();
        assert_eq!(cfg.custom_path, Some("/usr/local/bin/claude".to_string()));
        assert!(!cfg.auto_detect);
    }

    #[test]
    fn leaves_none_paths_untouched() {
        let mut settings = Settings::default();
        settings.agent_binaries.claude = make_config("claude", None);

        clean_invalid_binary_paths(&mut settings);

        let cfg = settings.agent_binaries.claude.unwrap();
        assert!(cfg.custom_path.is_none());
    }

    #[test]
    fn js_path_reverts_to_auto_detect_when_no_wrapper_found() {
        let mut settings = Settings::default();
        let agent_name = missing_agent_name("claude");
        settings.agent_binaries.claude =
            make_config(&agent_name, Some("/some/node_modules/.bin/claude.js"));

        clean_invalid_binary_paths(&mut settings);

        let cfg = settings.agent_binaries.claude.unwrap();
        assert!(cfg.custom_path.is_none());
        assert!(cfg.auto_detect);
    }

    #[test]
    fn mjs_path_reverts_to_auto_detect_when_no_wrapper_found() {
        let mut settings = Settings::default();
        let agent_name = missing_agent_name("codex");
        settings.agent_binaries.codex =
            make_config(&agent_name, Some("/tmp/codex.mjs"));

        clean_invalid_binary_paths(&mut settings);

        let cfg = settings.agent_binaries.codex.unwrap();
        assert!(cfg.custom_path.is_none());
        assert!(cfg.auto_detect);
    }

    #[test]
    fn skips_agents_with_no_config() {
        let mut settings = Settings::default();
        settings.agent_binaries.claude = None;

        clean_invalid_binary_paths(&mut settings);

        assert!(settings.agent_binaries.claude.is_none());
    }

    #[test]
    fn processes_all_agent_fields() {
        let mut settings = Settings::default();
        settings.agent_binaries.claude =
            make_config(&missing_agent_name("claude"), Some("/x/claude.js"));
        settings.agent_binaries.copilot =
            make_config(&missing_agent_name("copilot"), Some("/x/copilot.js"));
        settings.agent_binaries.opencode =
            make_config(&missing_agent_name("opencode"), Some("/x/opencode.js"));
        settings.agent_binaries.gemini =
            make_config(&missing_agent_name("gemini"), Some("/x/gemini.js"));
        settings.agent_binaries.codex =
            make_config(&missing_agent_name("codex"), Some("/x/codex.js"));
        settings.agent_binaries.droid =
            make_config(&missing_agent_name("droid"), Some("/x/droid.js"));
        settings.agent_binaries.qwen =
            make_config(&missing_agent_name("qwen"), Some("/x/qwen.js"));
        settings.agent_binaries.amp =
            make_config(&missing_agent_name("amp"), Some("/x/amp.js"));
        settings.agent_binaries.kilocode =
            make_config(&missing_agent_name("kilocode"), Some("/x/kilocode.js"));

        clean_invalid_binary_paths(&mut settings);

        let check = |cfg: &Option<AgentBinaryConfig>, name: &str| {
            let c = cfg.as_ref().unwrap();
            assert!(
                c.auto_detect,
                "{name} should have reverted to auto_detect"
            );
        };
        check(&settings.agent_binaries.claude, "claude");
        check(&settings.agent_binaries.copilot, "copilot");
        check(&settings.agent_binaries.opencode, "opencode");
        check(&settings.agent_binaries.gemini, "gemini");
        check(&settings.agent_binaries.codex, "codex");
        check(&settings.agent_binaries.droid, "droid");
        check(&settings.agent_binaries.qwen, "qwen");
        check(&settings.agent_binaries.amp, "amp");
        check(&settings.agent_binaries.kilocode, "kilocode");
    }
}
