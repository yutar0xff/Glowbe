//! mDNS discovery for `_glowbe._udp` (ESP advertises via `MDNS.addService("glowbe", "udp", port)`).
//!
//! Each browse creates a temporary `ServiceDaemon` and **always** shuts it down.
//! Leaving daemons alive leaks sockets/threads and eventually exhausts the process
//! FD soft limit (often 1024), which makes HTTP API calls stall and the Studio UI
//! show "Runtime unavailable".

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use flume::RecvTimeoutError;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use tracing::warn;

use crate::devices::normalize_mdns_hostname;

const SERVICE_TYPE: &str = "_glowbe._udp.local.";

#[derive(Debug, Clone)]
pub struct GlowbeService {
    pub hostname: String,
    pub ipv4: String,
    pub port: u16,
    pub addr: SocketAddr,
}

/// Ensures `stop_browse` + `shutdown` run even on early return / panic unwind paths.
struct DaemonGuard {
    daemon: ServiceDaemon,
    browsing: bool,
}

impl DaemonGuard {
    fn new(daemon: ServiceDaemon) -> Self {
        Self {
            daemon,
            browsing: false,
        }
    }

    fn browse(&mut self) -> Option<flume::Receiver<ServiceEvent>> {
        match self.daemon.browse(SERVICE_TYPE) {
            Ok(r) => {
                self.browsing = true;
                Some(r)
            }
            Err(e) => {
                warn!("mDNS browse failed: {e}");
                None
            }
        }
    }
}

impl Drop for DaemonGuard {
    fn drop(&mut self) {
        if self.browsing {
            if let Err(e) = self.daemon.stop_browse(SERVICE_TYPE) {
                warn!("mDNS stop_browse failed: {e}");
            }
            self.browsing = false;
        }
        match self.daemon.shutdown() {
            Ok(rx) => {
                // Wait briefly so the daemon thread can exit and release FDs.
                let _ = rx.recv_timeout(Duration::from_secs(2));
            }
            Err(e) => warn!("mDNS shutdown failed: {e}"),
        }
    }
}

/// Blocking: first resolved IPv4 + service port, or `None` after timeout.
pub fn glowbe_udp_first_ipv4() -> Option<SocketAddr> {
    browse_glowbe(Duration::from_secs(12), BrowseMode::First).into_iter().next().map(|s| s.addr)
}

/// Blocking: service matching `hostname` (`.local` optional), or `None` after timeout.
pub fn glowbe_udp_by_hostname(hostname: &str, timeout: Duration) -> Option<SocketAddr> {
    browse_glowbe(timeout, BrowseMode::MatchHostname(hostname)).into_iter().next().map(|s| s.addr)
}

/// Blocking: all resolved `_glowbe._udp` services within `timeout`.
pub fn glowbe_udp_all(timeout: Duration) -> Vec<GlowbeService> {
    browse_glowbe(timeout, BrowseMode::CollectAll)
}

enum BrowseMode<'a> {
    CollectAll,
    First,
    MatchHostname(&'a str),
}

fn browse_glowbe(timeout: Duration, mode: BrowseMode<'_>) -> Vec<GlowbeService> {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            warn!("mDNS ServiceDaemon::new failed: {e}");
            return Vec::new();
        }
    };
    let mut guard = DaemonGuard::new(daemon);
    let Some(receiver) = guard.browse() else {
        return Vec::new();
    };

    let deadline = Instant::now() + timeout;
    let mut by_host: HashMap<String, GlowbeService> = HashMap::new();
    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let raw_host = info.get_hostname().trim_end_matches('.').to_string();
                let hostname = normalize_mdns_hostname(&raw_host).unwrap_or(raw_host);
                for addr in info.get_addresses() {
                    if let IpAddr::V4(v4) = addr {
                        let port = info.get_port();
                        let ipv4 = v4.to_string();
                        let key = format!("{hostname}:{port}");
                        by_host.insert(
                            key,
                            GlowbeService {
                                hostname: hostname.clone(),
                                ipv4,
                                port,
                                addr: SocketAddr::new(IpAddr::V4(*v4), port),
                            },
                        );
                    }
                }
                match mode {
                    BrowseMode::First if !by_host.is_empty() => break,
                    BrowseMode::MatchHostname(want)
                        if by_host.values().any(|s| {
                            crate::devices::mdns_hosts_match(&s.hostname, want)
                        }) =>
                    {
                        break;
                    }
                    _ => {}
                }
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let mut out: Vec<GlowbeService> = match mode {
        BrowseMode::MatchHostname(want) => by_host
            .into_values()
            .filter(|s| crate::devices::mdns_hosts_match(&s.hostname, want))
            .collect(),
        _ => by_host.into_values().collect(),
    };
    out.sort_by(|a, b| a.hostname.cmp(&b.hostname));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_browse_returns_and_shuts_down() {
        // No ESP required: must finish promptly and drop the daemon without hanging.
        let start = Instant::now();
        let _ = glowbe_udp_all(Duration::from_millis(400));
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "browse+shutdown should finish quickly"
        );
    }

    #[test]
    fn repeated_browses_do_not_accumulate_daemons() {
        for _ in 0..5 {
            let _ = glowbe_udp_all(Duration::from_millis(200));
        }
    }
}
