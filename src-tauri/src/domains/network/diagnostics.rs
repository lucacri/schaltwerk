use log::warn;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::{Duration, Instant};

pub use crate::shared::network::{extract_hostname_from_stderr, is_connection_error};

#[derive(Debug, Clone, serde::Serialize)]
pub enum ConnectionVerdict {
    AppWide,
    SubprocessOnly,
    Transient,
    TauriProcess,
}

impl std::fmt::Display for ConnectionVerdict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionVerdict::AppWide => write!(f, "APP_WIDE"),
            ConnectionVerdict::SubprocessOnly => write!(f, "SUBPROCESS_ONLY"),
            ConnectionVerdict::Transient => write!(f, "TRANSIENT"),
            ConnectionVerdict::TauriProcess => write!(f, "TAURI_PROCESS"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DiagnosticResult {
    pub label: String,
    pub ok: bool,
    pub detail: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct NetworkDiagnosticReport {
    pub hostname: String,
    pub session_name: String,
    pub results: Vec<DiagnosticResult>,
    pub verdict: ConnectionVerdict,
    pub tauri_tcp_probe_ok: bool,
    pub subprocess_probe_ok: bool,
}

pub fn determine_verdict(
    dns_ok: bool,
    _ping_ok: bool,
    tauri_tcp_ok: bool,
    subprocess_ok: bool,
) -> ConnectionVerdict {
    if !dns_ok || (!tauri_tcp_ok && !subprocess_ok) {
        ConnectionVerdict::AppWide
    } else if tauri_tcp_ok && subprocess_ok {
        ConnectionVerdict::Transient
    } else if tauri_tcp_ok && !subprocess_ok {
        ConnectionVerdict::SubprocessOnly
    } else {
        ConnectionVerdict::TauriProcess
    }
}

pub fn format_report(report: &NetworkDiagnosticReport) -> String {
    let mut lines = vec![format!(
        "[NETWORK_DIAG] session={} host={} ts={}",
        report.session_name,
        report.hostname,
        chrono::Utc::now().to_rfc3339()
    )];
    for result in &report.results {
        let status = if result.ok { "ok" } else { "FAILED" };
        lines.push(format!(
            "  {}: {} ({}, {}ms)",
            result.label, result.detail, status, result.duration_ms
        ));
    }
    lines.push(format!("  verdict: {}", report.verdict));
    lines.join("\n")
}

fn run_command(program: &str, args: &[&str]) -> (bool, String, u64) {
    let start = Instant::now();
    let result = Command::new(program).args(args).output();
    let elapsed = start.elapsed().as_millis() as u64;
    match result {
        Ok(output) if output.status.success() => (
            true,
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
            elapsed,
        ),
        Ok(output) => (
            false,
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
            elapsed,
        ),
        Err(e) => (false, e.to_string(), elapsed),
    }
}

fn probe_tcp(hostname: &str, port: u16, timeout: Duration) -> DiagnosticResult {
    let start = Instant::now();
    let addr_str = format!("{hostname}:{port}");
    let result = addr_str
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .and_then(|addr| TcpStream::connect_timeout(&addr, timeout).ok());
    let elapsed = start.elapsed().as_millis() as u64;
    let ok = result.is_some();
    DiagnosticResult {
        label: "tauri_tcp_probe".to_string(),
        ok,
        detail: if ok {
            format!("connected to {addr_str}")
        } else {
            format!("failed to connect to {addr_str}")
        },
        duration_ms: elapsed,
    }
}

fn probe_subprocess(hostname: &str) -> DiagnosticResult {
    let url = format!("https://{hostname}");
    let (ok, detail, ms) = run_command(
        "curl",
        &["-m", "5", "-o", "/dev/null", "-s", "-w", "%{http_code}", &url],
    );
    let subprocess_ok = ok && detail != "000";
    DiagnosticResult {
        label: "subprocess_curl_probe".to_string(),
        ok: subprocess_ok,
        detail: if subprocess_ok {
            format!("HTTP {detail}")
        } else {
            format!("failed: {detail}")
        },
        duration_ms: ms,
    }
}

pub fn capture_diagnostics(hostname: &str, session_name: &str) -> NetworkDiagnosticReport {
    let mut results = Vec::new();
    let timeout = Duration::from_secs(5);

    let (dns_ok, dns_detail, dns_ms) = run_command("dig", &[hostname, "+short"]);
    results.push(DiagnosticResult {
        label: "dns_resolution".into(),
        ok: dns_ok,
        detail: dns_detail.lines().next().unwrap_or("").to_string(),
        duration_ms: dns_ms,
    });

    let (ping_ok, ping_detail, ping_ms) = run_command("ping", &["-c", "1", "-W", "2", hostname]);
    let ping_summary = ping_detail
        .lines()
        .find(|l| l.contains("time="))
        .unwrap_or("no response")
        .to_string();
    results.push(DiagnosticResult {
        label: "icmp_ping".into(),
        ok: ping_ok,
        detail: ping_summary,
        duration_ms: ping_ms,
    });

    let tcp_result = probe_tcp(hostname, 443, timeout);
    let tauri_tcp_ok = tcp_result.ok;
    results.push(tcp_result);

    let subprocess_result = probe_subprocess(hostname);
    let subprocess_ok = subprocess_result.ok;
    results.push(subprocess_result);

    let resolved_ip = results
        .first()
        .filter(|r| r.ok)
        .map(|r| r.detail.clone())
        .unwrap_or_default();
    if !resolved_ip.is_empty() {
        let (arp_ok, arp_detail, arp_ms) = run_command("arp", &["-a"]);
        let arp_entry = arp_detail
            .lines()
            .find(|l| l.contains(&resolved_ip))
            .unwrap_or("not found")
            .to_string();
        results.push(DiagnosticResult {
            label: "arp_entry".into(),
            ok: arp_ok,
            detail: arp_entry,
            duration_ms: arp_ms,
        });

        let (route_ok, route_detail, route_ms) = run_command("route", &["get", &resolved_ip]);
        let route_summary = route_detail
            .lines()
            .filter(|l| l.contains("interface:") || l.contains("gateway:"))
            .collect::<Vec<_>>()
            .join(", ");
        results.push(DiagnosticResult {
            label: "route".into(),
            ok: route_ok,
            detail: if route_summary.is_empty() {
                route_detail.chars().take(200).collect()
            } else {
                route_summary
            },
            duration_ms: route_ms,
        });

        let (lsof_ok, lsof_detail, lsof_ms) =
            run_command("lsof", &["-i", &format!("@{resolved_ip}"), "-P"]);
        let conn_count = lsof_detail.lines().count().saturating_sub(1);
        results.push(DiagnosticResult {
            label: "open_connections".into(),
            ok: lsof_ok,
            detail: format!("{conn_count} connections"),
            duration_ms: lsof_ms,
        });

        let pid = std::process::id().to_string();
        let (_, pid_sockets, pid_ms) = run_command(
            "lsof",
            &["-p", &pid, "-i", &format!("@{resolved_ip}"), "-P"],
        );
        let pid_count = pid_sockets.lines().count().saturating_sub(1);
        results.push(DiagnosticResult {
            label: "tauri_process_sockets".into(),
            ok: true,
            detail: format!("{pid_count} sockets held by Tauri PID {pid}"),
            duration_ms: pid_ms,
        });
    }

    let verdict = determine_verdict(dns_ok, ping_ok, tauri_tcp_ok, subprocess_ok);
    NetworkDiagnosticReport {
        hostname: hostname.into(),
        session_name: session_name.into(),
        results,
        verdict,
        tauri_tcp_probe_ok: tauri_tcp_ok,
        subprocess_probe_ok: subprocess_ok,
    }
}

pub fn log_diagnostics(hostname: &str, session_name: &str) -> NetworkDiagnosticReport {
    let report = capture_diagnostics(hostname, session_name);
    warn!("{}", format_report(&report));
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdict_app_wide_when_both_fail() {
        assert!(matches!(
            determine_verdict(true, true, false, false),
            ConnectionVerdict::AppWide
        ));
    }

    #[test]
    fn verdict_subprocess_only_when_tauri_ok_subprocess_fails() {
        assert!(matches!(
            determine_verdict(true, true, true, false),
            ConnectionVerdict::SubprocessOnly
        ));
    }

    #[test]
    fn verdict_transient_when_both_ok() {
        assert!(matches!(
            determine_verdict(true, true, true, true),
            ConnectionVerdict::Transient
        ));
    }

    #[test]
    fn verdict_tauri_process_when_tauri_fails_subprocess_ok() {
        assert!(matches!(
            determine_verdict(true, true, false, true),
            ConnectionVerdict::TauriProcess
        ));
    }

    #[test]
    fn verdict_app_wide_on_dns_failure() {
        assert!(matches!(
            determine_verdict(false, false, false, false),
            ConnectionVerdict::AppWide
        ));
    }

    #[test]
    fn format_report_is_greppable() {
        let report = NetworkDiagnosticReport {
            hostname: "gitlab.example.com".to_string(),
            session_name: "test-session".to_string(),
            results: vec![DiagnosticResult {
                label: "dns_resolution".to_string(),
                ok: true,
                detail: "10.0.0.1".to_string(),
                duration_ms: 2,
            }],
            verdict: ConnectionVerdict::AppWide,
            tauri_tcp_probe_ok: false,
            subprocess_probe_ok: false,
        };
        let formatted = format_report(&report);
        assert!(formatted.contains("[NETWORK_DIAG]"));
        assert!(formatted.contains("session=test-session"));
        assert!(formatted.contains("host=gitlab.example.com"));
        assert!(formatted.contains("verdict: APP_WIDE"));
    }

    #[test]
    fn connection_error_patterns_detected() {
        assert!(is_connection_error(
            "dial tcp 10.17.0.127:443: connect: no route to host"
        ));
        assert!(is_connection_error(
            "Get https://example.com: connection refused"
        ));
        assert!(is_connection_error(
            "Could not resolve host: gitlab.example.com"
        ));
        assert!(is_connection_error("network is unreachable"));
        assert!(is_connection_error("connection timed out"));
        assert!(!is_connection_error("401 Unauthorized"));
        assert!(!is_connection_error("invalid JSON response"));
    }

    #[test]
    fn extract_hostname_from_url_in_stderr() {
        assert_eq!(
            extract_hostname_from_stderr(
                "Get \"https://gitlab.critel.li/api/v4/projects\": dial tcp"
            ),
            Some("gitlab.critel.li".to_string())
        );
        assert_eq!(extract_hostname_from_stderr("no useful info here"), None);
    }

    #[test]
    fn verdict_display_matches_expected_strings() {
        assert_eq!(ConnectionVerdict::AppWide.to_string(), "APP_WIDE");
        assert_eq!(
            ConnectionVerdict::SubprocessOnly.to_string(),
            "SUBPROCESS_ONLY"
        );
        assert_eq!(ConnectionVerdict::Transient.to_string(), "TRANSIENT");
        assert_eq!(
            ConnectionVerdict::TauriProcess.to_string(),
            "TAURI_PROCESS"
        );
    }
}
