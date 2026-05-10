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
        .expect("santral: app/data/apps.json bozuk JSON");

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
    let candidates = ["apt", "dnf", "pacman", "zypper", "flatpak", "snap"];
    candidates
        .iter()
        .filter(|c| which::which(c).is_ok())
        .map(|c| c.to_string())
        .collect()
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
