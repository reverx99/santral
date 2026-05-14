//! Tarama arşivi: data/scanners.json embed edilir, her tarama aracının binary
//! varlığı (which) kontrol edilir, kullanıcının distrosuna uygun kurulum
//! kaynağı işaretlenir. Salt-okunur — kurulum yok, tarama yok (sonraki turda).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SCANNERS_JSON: &str = include_str!("../../data/scanners.json");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Scanner {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    #[serde(default)]
    pub homepage: Option<String>,
    pub speed: String,
    pub needs_root: bool,
    pub scan_command: Vec<String>,
    #[serde(default)]
    pub estimated_secs: Option<u32>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub sources: HashMap<String, String>,
    #[serde(default)]
    pub always_available_on: Vec<String>,

    // runtime-injected:
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub installable: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScanCategory {
    pub id: String,
    pub label: String,
    pub color: String,
    #[serde(default)]
    pub glyph: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScanCatalog {
    pub version: u32,
    pub updated: String,
    pub categories: Vec<ScanCategory>,
    pub scanners: Vec<Scanner>,
    pub detected_sources: Vec<String>,
    pub preferred_source: Option<String>,
}

#[derive(Deserialize)]
struct RawCatalog {
    version: u32,
    #[serde(default)]
    updated: String,
    categories: Vec<ScanCategory>,
    scanners: Vec<Scanner>,
}

pub fn collect() -> ScanCatalog {
    let mut raw: RawCatalog = serde_json::from_str(SCANNERS_JSON)
        .expect("fitlinux: app/data/scanners.json bozuk JSON");

    let detected = detect_sources();
    let preferred = preferred_native(&detected);

    for s in &mut raw.scanners {
        s.installed = which::which(&s.scan_command[0]).is_ok();
        s.installable = if s
            .always_available_on
            .iter()
            .any(|src| detected.contains(src))
        {
            true
        } else {
            s.sources.keys().any(|src| detected.contains(src))
        };
    }

    ScanCatalog {
        version: raw.version,
        updated: raw.updated,
        categories: raw.categories,
        scanners: raw.scanners,
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
    for native in ["apt", "dnf", "pacman", "zypper"] {
        if detected.iter().any(|d| d == native) {
            return Some(native.to_string());
        }
    }
    None
}
