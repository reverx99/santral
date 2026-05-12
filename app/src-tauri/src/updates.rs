//! Güncelleme tarama — her paket yöneticisinde mevcut paket güncellemelerini
//! sayar. Ağ erişimi olabilir (apt update / dnf check-update tazelemek
//! isteyebilir); -C cache flag'i ya da quick path kullanırız.

use crate::util::timed;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Debug)]
pub struct UpdateCheck {
    pub native_kind: String,
    pub native_count: Option<u64>,
    pub flatpak_count: Option<u64>,
    pub snap_count: Option<u64>,
    pub total: u64,
    pub checked_at: u64,
}

pub fn check() -> UpdateCheck {
    let kind = detect_native_kind();
    let native = check_native(&kind);
    let flatpak = check_flatpak();
    let snap = check_snap();
    let total = native.unwrap_or(0) + flatpak.unwrap_or(0) + snap.unwrap_or(0);
    UpdateCheck {
        native_kind: kind,
        native_count: native,
        flatpak_count: flatpak,
        snap_count: snap,
        total,
        checked_at: SystemTime::now().duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs()).unwrap_or(0),
    }
}

fn detect_native_kind() -> String {
    for k in ["apt", "dnf", "pacman", "zypper"] {
        if which::which(k).is_ok() {
            return k.to_string();
        }
    }
    "unknown".to_string()
}

fn check_native(kind: &str) -> Option<u64> {
    match kind {
        "apt" => {
            // apt list --upgradable
            let out = timed("apt", 15).args(["list", "--upgradable"]).output().ok()?;
            if !out.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&out.stdout);
            // "Listing... Done" başlık satırını atla, geri kalan her satır bir paket
            Some(text.lines()
                .filter(|l| !l.is_empty() && !l.starts_with("Listing") && l.contains("/"))
                .count() as u64)
        }
        "dnf" => {
            // dnf check-update: exit 0 = no updates, 100 = updates available
            let out = timed("dnf", 30).args(["check-update", "-q", "-C"]).output().ok()?;
            let code = out.status.code().unwrap_or(-1);
            if code == 0 { return Some(0); }
            if code == 100 {
                let text = String::from_utf8_lossy(&out.stdout);
                return Some(text.lines()
                    .filter(|l| {
                        let t = l.trim();
                        !t.is_empty()
                            && !t.starts_with("Last metadata")
                            && !t.starts_with("Obsoleting")
                            && t.split_whitespace().count() >= 3
                    })
                    .count() as u64);
            }
            None
        }
        "pacman" => {
            // checkupdates: pacman-contrib paketi. yoksa None.
            if which::which("checkupdates").is_err() {
                return None;
            }
            let out = timed("checkupdates", 15).output().ok()?;
            // exit 2 = no updates, 0 = updates listed, 1 = error
            let code = out.status.code().unwrap_or(-1);
            if code == 2 { return Some(0); }
            if code != 0 { return None; }
            let text = String::from_utf8_lossy(&out.stdout);
            Some(text.lines().filter(|l| !l.trim().is_empty()).count() as u64)
        }
        "zypper" => {
            let out = timed("zypper", 30).args(["-q", "list-updates"]).output().ok()?;
            if !out.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&out.stdout);
            Some(text.lines()
                .filter(|l| l.trim_start().starts_with('v') || l.contains(" | "))
                .filter(|l| !l.starts_with("S |"))
                .count() as u64)
        }
        _ => None,
    }
}

fn check_flatpak() -> Option<u64> {
    if which::which("flatpak").is_err() {
        return None;
    }
    let out = timed("flatpak", 30)
        .args(["remote-ls", "--updates", "--user", "--columns=application"])
        .output()
        .ok()?;
    if !out.status.success() {
        // fallback: --system güncellemelerini de say (network gerekir)
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.lines().filter(|l| !l.trim().is_empty()).count() as u64)
}

fn check_snap() -> Option<u64> {
    if which::which("snap").is_err() {
        return None;
    }
    let out = timed("snap", 20).args(["refresh", "--list"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // ilk satır başlık ("All snaps up to date." veya tablo header)
    if text.contains("All snaps up to date") {
        return Some(0);
    }
    Some(text.lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .count() as u64)
}
