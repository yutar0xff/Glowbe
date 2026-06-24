//! mDNS discovery for `_glowbe._udp` (ESP advertises via `MDNS.addService("glowbe", "udp", port)`).

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use flume::RecvTimeoutError;
use mdns_sd::{ServiceDaemon, ServiceEvent};

#[derive(Debug, Clone)]
pub struct GlowbeService {
    pub hostname: String,
    pub ipv4: String,
    pub port: u16,
    pub addr: SocketAddr,
}

/// Blocking: first resolved IPv4 + service port, or `None` after timeout.
pub fn glowbe_udp_first_ipv4() -> Option<SocketAddr> {
    glowbe_udp_all(Duration::from_secs(12))
        .into_iter()
        .next()
        .map(|s| s.addr)
}

/// Blocking: all resolved `_glowbe._udp` services within `timeout`.
pub fn glowbe_udp_all(timeout: Duration) -> Vec<GlowbeService> {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let receiver = match daemon.browse("_glowbe._udp.local.") {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let deadline = Instant::now() + timeout;
    let mut by_host: HashMap<String, GlowbeService> = HashMap::new();
    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let hostname = info.get_hostname().trim_end_matches('.').to_string();
                for addr in info.get_addresses() {
                    if let IpAddr::V4(v4) = addr {
                        let port = info.get_port();
                        let ipv4 = v4.to_string();
                        let entry = GlowbeService {
                            hostname: hostname.clone(),
                            ipv4: ipv4.clone(),
                            port,
                            addr: SocketAddr::new(IpAddr::V4(*v4), port),
                        };
                        by_host.insert(format!("{hostname}:{port}"), entry);
                    }
                }
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    let mut out: Vec<GlowbeService> = by_host.into_values().collect();
    out.sort_by(|a, b| a.hostname.cmp(&b.hostname));
    out
}
