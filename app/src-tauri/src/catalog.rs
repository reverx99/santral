//! Uygulama arşivi: data/apps.json embed edilir, hangi kaynakların (apt/dnf/
//! pacman/zypper/flatpak/snap) bu sistemde kullanılabilir olduğu işaretlenir.
//! Salt-okunur — kurulum yapmaz.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const APPS_JSON: &str = include_str!("../../data/apps.json");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Catalog {
    pub version: u32,
    pub updated: String,
    pub categories: Vec<Category>,
    pub apps: Vec<App>,
    /// Sistemde hâlihazırda kurulu olan kaynaklar
    /// (örn. ["apt", "flatpak"]). Frontend bununla "kurulabilir" rozeti boyar.
    #[serde(default)]
    pub detected_sources: Vec<String>,
    /// Sistem distrosunun tercih edilen native paket yöneticisi.
    #[serde(default)]
    pub preferred_source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Category {
    pub id: String,
    pub label: String,
    pub color: String,
    #[serde(default)]
    pub glyph: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct App {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// kaynak adı → o pakette bu uygulamanın id'si (ör. "firefox" / "org.mozilla.firefox")
    pub sources: HashMap<String, String>,
}

#[derive(Deserialize)]
struct RawCatalog {
    version: u32,
    #[serde(default)]
    updated: String,
    categories: Vec<Category>,
    apps: Vec<App>,
}

pub fn collect() -> Catalog {
    let raw: RawCatalog = serde_json::from_str(APPS_JSON)
        .expect("fitlinux: app/data/apps.json bozuk JSON");

    let detected = detect_sources();
    let preferred = preferred_native(&detected);

    Catalog {
        version: raw.version,
        updated: raw.updated,
        categories: raw.categories,
        apps: raw.apps,
        detected_sources: detected,
        preferred_source: preferred,
    }
}

fn detect_sources() -> Vec<String> {
    // Native PM ve flatpak için sadece binary varlığı yeterli. Snap için
    // `snapd.socket` aktif olmalı — aksi halde "snap install ..." cryptic
    // hata verir (Arch'ta sık görülen senaryo: snapd paketi kurulu ama
    // socket manuel etkinleştirilmemiş). Bu yüzden snap için ekstra prob.
    let mut out = Vec::new();
    for c in ["apt", "dnf", "pacman", "zypper", "flatpak"] {
        if which::which(c).is_ok() {
            out.push(c.to_string());
        }
    }
    if which::which("snap").is_ok() && snap_is_ready() {
        out.push("snap".to_string());
    }
    out
}

/// snapd çalışıyor mu? `snap list` 1 sn içinde döndürmeli; aksi halde
/// servis pasif veya bozuk demektir.
fn snap_is_ready() -> bool {
    use std::process::{Command, Stdio};
    use std::time::Duration;
    let mut child = match Command::new("snap")
        .arg("list")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    // Basit timeout: 2 sn içinde tamamlanmazsa kill et.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return false;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return false,
        }
    }
}

fn preferred_native(detected: &[String]) -> Option<String> {
    // distro paket yöneticisi flatpak/snap'ten öncelikli.
    for native in ["apt", "dnf", "pacman", "zypper"] {
        if detected.iter().any(|d| d == native) {
            return Some(native.to_string());
        }
    }
    None
}
