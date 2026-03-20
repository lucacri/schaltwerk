pub const CONNECTION_ERROR_PATTERNS: &[&str] = &[
    "no route to host",
    "connection refused",
    "connection timed out",
    "could not resolve host",
    "network is unreachable",
];

pub fn is_connection_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    CONNECTION_ERROR_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

pub fn extract_hostname_from_stderr(stderr: &str) -> Option<String> {
    let url_start = stderr.find("https://").or_else(|| stderr.find("http://"))?;
    let url_part = &stderr[url_start..];
    let url_str = url_part
        .split('"')
        .next()
        .unwrap_or(url_part)
        .split_whitespace()
        .next()
        .unwrap_or(url_part);
    url::Url::parse(url_str)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
}
