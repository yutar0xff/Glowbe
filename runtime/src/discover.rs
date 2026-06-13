//! mDNS discovery for `_glowbe._udp` (ESP advertises via `MDNS.addService("glowbe", "udp", port)`).

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use flume::RecvTimeoutError;
use mdns_sd::{ServiceDaemon, ServiceEvent};

/// Blocking: first resolved IPv4 + service port, or `None` after timeout.
pub fn glowbe_udp_first_ipv4() -> Option<SocketAddr> {
    let daemon = ServiceDaemon::new().ok()?;
    let receiver = daemon.browse("_glowbe._udp.local.").ok()?;
    let deadline = std::time::Instant::now() + Duration::from_secs(12);
    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                for addr in info.get_addresses() {
                    if let IpAddr::V4(v4) = addr {
                        return Some(SocketAddr::new(IpAddr::V4(*v4), info.get_port()));
                    }
                }
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    None
}
