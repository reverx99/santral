//! Distro tespiti: /etc/os-release okur, paket yöneticisini ve flatpak/snap'i
//! sezer. Saf okuma — hiçbir şey kurmaz.

use crate::util::timed;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Clone, Debug)]
pub struct DistroInfo {
    pub name: String,
    pub pretty_name: String,
    pub id: String,
    pub id_like: Vec<String>,
    pub version: String,
    pub version_id: String,
    pub codename: String,
    pub package_manager: PackageManager,
    pub flatpak: Toolchain,
    pub snap: Toolchain,
}

#[derive(Serialize, Clone, Debug)]
pub struct PackageManager {
    pub kind: String,
    pub command: String,
    pub installed_count: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Toolchain {
    pub installed: bool,
    pub version: Option<String>,
}

pub fn collect() -> DistroInfo {
    let os = parse_os_release();
    let id = os.get("ID").cloned().unwrap_or_default();
    let id_like: Vec<String> = os
        .get("ID_LIKE")
        .map(|s| s.split_whitespace().map(String::from).collect())
        .unwrap_or_default();

    let pkg = detect_package_manager(&id, &id_like);
    let flatpak = detect_tool("flatpak", &["--version"]);
    let snap = detect_tool("snap", &["--version"]);

    DistroInfo {
        name: os.get("NAME").cloned().unwrap_or_default(),
        pretty_name: os
            .get("PRETTY_NAME")
            .cloned()
            .unwrap_or_else(|| "Linux".to_string()),
        id,
        id_like,
        version: os.get("VERSION").cloned().unwrap_or_default(),
        version_id: os.get("VERSION_ID").cloned().unwrap_or_default(),
        codename: os.get("VERSION_CODENAME").cloned().unwrap_or_default(),
        package_manager: pkg,
        flatpak,
        snap,
    }
}

fn parse_os_release() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let content = std::fs::read_to_string("/etc/os-release")
        .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        .unwrap_or_default();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim().trim_matches('"').trim_matches('\'');
            out.insert(k.trim().to_string(), v.to_string());
        }
    }
    out
}

fn detect_package_manager(id: &str, id_like: &[String]) -> PackageManager {
    // önce id'ye, sonra id_like'a, son olarak komut varlığına bakar
    let candidates: &[(&str, &str, &str)] = &[
        ("debian",    "apt",    "apt"),
        ("ubuntu",    "apt",    "apt"),
        ("linuxmint", "apt",    "apt"),
        ("pop",       "apt",    "apt"),
        ("fedora",    "dnf",    "dnf"),
        ("rhel",      "dnf",    "dnf"),
        ("centos",    "dnf",    "dnf"),
        ("rocky",     "dnf",    "dnf"),
        ("almalinux", "dnf",    "dnf"),
        ("arch",      "pacman", "pacman"),
        ("manjaro",   "pacman", "pacman"),
        ("endeavouros","pacman","pacman"),
        ("opensuse",  "zypper", "zypper"),
        ("opensuse-leap",  "zypper", "zypper"),
        ("opensuse-tumbleweed", "zypper", "zypper"),
        ("sles",      "zypper", "zypper"),
    ];
    let mut found: Option<(&str, &str)> = None;
    for (key, kind, cmd) in candidates {
        if id == *key {
            found = Some((kind, cmd));
            break;
        }
    }
    if found.is_none() {
        for like in id_like {
            for (key, kind, cmd) in candidates {
                if like == key {
                    found = Some((kind, cmd));
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
    }
    // os-release'ten gelen sonuç güvenilir mi? Eşleşen paket yöneticisinin
    // binary'si PATH'te yoksa (ör. minimal/özel kurulum) gerçekten kurulu
    // olana fallback yap. Mint→Debian ya da Pop!_OS→Ubuntu gibi yanlış
    // sınıflama olsa bile install kind'leri yine apt olduğundan riski yok;
    // ama "dnf" diyip dnf yoksa silent fail olur.
    if let Some((kind, _)) = found {
        if which::which(kind).is_err() {
            found = None;
        }
    }
    if found.is_none() {
        for kind in &["apt", "dnf", "pacman", "zypper"] {
            if which::which(kind).is_ok() {
                found = Some((kind, kind));
                break;
            }
        }
    }
    let (kind, cmd) = found.unwrap_or(("unknown", ""));
    PackageManager {
        kind: kind.to_string(),
        command: cmd.to_string(),
        installed_count: count_installed(kind),
    }
}

fn count_installed(kind: &str) -> Option<u64> {
    let out = match kind {
        "apt"    => timed("dpkg-query", 15).args(["-f=.\n", "-W"]).output().ok()?,
        "dnf"    => timed("rpm", 15).args(["-qa"]).output().ok()?,
        "pacman" => timed("pacman", 10).args(["-Q"]).output().ok()?,
        "zypper" => timed("rpm", 15).args(["-qa"]).output().ok()?,
        _        => return None,
    };
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.lines().filter(|l| !l.trim().is_empty()).count() as u64)
}

fn detect_tool(name: &str, version_args: &[&str]) -> Toolchain {
    if which::which(name).is_err() {
        return Toolchain { installed: false, version: None };
    }
    let version = timed(name, 5)
        .args(version_args)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string())
            } else {
                None
            }
        });
    Toolchain { installed: true, version }
}
