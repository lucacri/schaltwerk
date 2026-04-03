pub fn build_initial_prompt(
    prompt: Option<&str>,
    autonomy_enabled: bool,
    autonomy_template: &str,
) -> Option<String> {
    let prompt = prompt?;

    if !autonomy_enabled || prompt.trim().is_empty() {
        return Some(prompt.to_string());
    }

    let normalized_template = autonomy_template.trim();
    if normalized_template.is_empty() {
        return Some(prompt.to_string());
    }

    if prompt.trim_end().ends_with(normalized_template) {
        return Some(prompt.to_string());
    }

    Some(format!("{prompt}\n\n{normalized_template}"))
}

#[cfg(test)]
mod tests {
    use super::build_initial_prompt;

    #[test]
    fn leaves_prompt_unchanged_when_autonomy_disabled() {
        assert_eq!(
            build_initial_prompt(Some("Fix bug"), false, "Template"),
            Some("Fix bug".to_string())
        );
    }

    #[test]
    fn appends_template_once_when_enabled() {
        assert_eq!(
            build_initial_prompt(Some("Fix bug"), true, "Template"),
            Some("Fix bug\n\nTemplate".to_string())
        );
    }

    #[test]
    fn does_not_append_template_to_empty_prompt() {
        assert_eq!(
            build_initial_prompt(Some("   "), true, "Template"),
            Some("   ".to_string())
        );
    }

    #[test]
    fn does_not_append_template_twice() {
        assert_eq!(
            build_initial_prompt(Some("Fix bug\n\nTemplate"), true, "Template"),
            Some("Fix bug\n\nTemplate".to_string())
        );
    }
}
