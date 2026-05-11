//! Yapılandırılmış paket depolarının listesi: native paket yöneticisinin
//! repolarını ve flatpak uzak depolarını okur. Salt-okunur — etkinleştir/
//! kaldır eylemleri sonraki turda polkit ile.

use crate::util::timed;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
pub struct RepoList {
    pub native_kind: String,
    pub native: Vec<RepoEntry>,
    pub flatpak: Vec<RepoEntry>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct RepoEntry {
    pub kind: String,           // "apt" | "dnf" | "pacman" | "zypper" | "flatpak"
    pub id: String,             // section/file/url
    pub name: String,           // human label
    pub url: String,
    pub enabled: bool,
    pub source_path: String,    // hangi dosyadan/yapılandırmadan geldi
    pub gpg_check: Option<bool>,
    pub official: bool,         // flathub gibi tanınmış olanlar
}

pub fn collect() -> RepoList {
    let kind = detect_native_kind();
    let native = match kind.as_str() {
        "apt"    => collect_apt(),
        "dnf"    => collect_dnf_zypper("/etc/yum.repos.d", "dnf"),
        "pacman" => collect_pacman(),
        "zypper" => collect_dnf_zypper("/etc/zypp/repos.d", "zypper"),
        _        => vec![],
    };
    let flatpak = collect_flatpak();
    RepoList { native_kind: kind, native, flatpak }
}

fn detect_native_kind() -> String {
    for k in ["apt", "dnf", "pacman", "zypper"] {
        if which::which(k).is_ok() {
            return k.to_string();
        }
    }
    "unknown".to_string()
}

/* ---------- apt ---------- */

fn collect_apt() -> Vec<RepoEntry> {
    let mut out = Vec::new();
    // /etc/apt/sources.list
    parse_apt_one_per_line(Path::new("/etc/apt/sources.list"), &mut out);
    // /etc/apt/sources.list.d/*.list
    if let Ok(entries) = std::fs::read_dir("/etc/apt/sources.list.d") {
        for e in entries.flatten() {
            let path = e.path();
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.ends_with(".list") {
                parse_apt_one_per_line(&path, &mut out);
            } else if name.ends_with(".sources") {
                parse_apt_deb822(&path, &mut out);
            }
        }
    }
    out
}

fn parse_apt_one_per_line(path: &Path, out: &mut Vec<RepoEntry>) {
    let Ok(content) = std::fs::read_to_string(path) else { return; };
    for raw in content.lines() {
        let line = raw.trim();
        let enabled = !line.starts_with('#');
        let stripped = line.trim_start_matches('#').trim();
        if !stripped.starts_with("deb") {
            continue;
        }
        // "deb [opts...] URI suite components..."  or "deb-src ..."
        let parts: Vec<&str> = stripped.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        // skip [options] like [arch=amd64 signed-by=...]
        let mut idx = 1;
        if parts.get(idx).map_or(false, |p| p.starts_with('[')) {
            while idx < parts.len() && !parts[idx].ends_with(']') {
                idx += 1;
            }
            idx += 1;
        }
        let uri = parts.get(idx).copied().unwrap_or("").to_string();
        let suite = parts.get(idx + 1).copied().unwrap_or("").to_string();
        let comps: Vec<&str> = parts.iter().skip(idx + 2).copied().collect();
        let label = if comps.is_empty() {
            format!("{} {}", parts[0], suite)
        } else {
            format!("{} {} ({})", parts[0], suite, comps.join(" "))
        };
        out.push(RepoEntry {
            kind: "apt".into(),
            id: format!("{}::{}::{}", parts[0], uri, suite),
            name: label,
            url: uri,
            enabled,
            source_path: path.display().to_string(),
            gpg_check: None,
            official: false,
        });
    }
}

fn parse_apt_deb822(path: &Path, out: &mut Vec<RepoEntry>) {
    let Ok(content) = std::fs::read_to_string(path) else { return; };
    let mut blocks: Vec<Vec<(String, String)>> = vec![Vec::new()];
    for line in content.lines() {
        if line.trim().is_empty() {
            blocks.push(Vec::new());
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            if let Some(b) = blocks.last_mut() {
                b.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
    }
    for block in blocks {
        if block.is_empty() { continue; }
        let mut entry = RepoEntry { kind: "apt".into(), source_path: path.display().to_string(), enabled: true, ..Default::default() };
        for (k, v) in &block {
            match k.to_ascii_lowercase().as_str() {
                "uris" => entry.url = v.clone(),
                "suites" => entry.name = v.clone(),
                "enabled" => entry.enabled = v.eq_ignore_ascii_case("yes") || v == "true" || v == "1",
                "types" => entry.id = format!("{}::{}", v, entry.url),
                _ => {}
            }
        }
        if !entry.url.is_empty() {
            if entry.name.is_empty() { entry.name = entry.url.clone(); }
            out.push(entry);
        }
    }
}

/* ---------- dnf / zypper (INI) ---------- */

fn collect_dnf_zypper(dir: &str, kind: &str) -> Vec<RepoEntry> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out; };
    for e in entries.flatten() {
        let path = e.path();
        if !path.extension().map_or(false, |x| x == "repo") {
            continue;
        }
        parse_repo_ini(&path, kind, &mut out);
    }
    out
}

fn parse_repo_ini(path: &Path, kind: &str, out: &mut Vec<RepoEntry>) {
    let Ok(content) = std::fs::read_to_string(path) else { return; };
    let mut current: Option<RepoEntry> = None;
    let commit = |cur: Option<RepoEntry>, out: &mut Vec<RepoEntry>| {
        if let Some(c) = cur {
            if !c.id.is_empty() { out.push(c); }
        }
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') { continue; }
        if let Some(section) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            commit(current.take(), out);
            current = Some(RepoEntry {
                kind: kind.into(),
                id: section.to_string(),
                source_path: path.display().to_string(),
                enabled: true,
                ..Default::default()
            });
            continue;
        }
        let Some((k, v)) = trimmed.split_once('=') else { continue; };
        let Some(c) = current.as_mut() else { continue; };
        match k.trim().to_ascii_lowercase().as_str() {
            "name"        => c.name = v.trim().to_string(),
            "baseurl"
            | "metalink"
            | "mirrorlist" => if c.url.is_empty() { c.url = v.trim().to_string(); },
            "enabled"     => c.enabled = matches!(v.trim(), "1" | "true" | "yes"),
            "gpgcheck"    => c.gpg_check = Some(matches!(v.trim(), "1" | "true" | "yes")),
            _ => {}
        }
    }
    commit(current, out);
}

/* ---------- pacman ---------- */

fn collect_pacman() -> Vec<RepoEntry> {
    let path = PathBuf::from("/etc/pacman.conf");
    let Ok(content) = std::fs::read_to_string(&path) else { return vec![]; };
    let mut out = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        let enabled = !trimmed.starts_with('#');
        let stripped = trimmed.trim_start_matches('#').trim();
        if let Some(id) = stripped.strip_prefix('[').and_then(|s| s.strip_suffix(']')).map(|s| s.to_string()) {
            if id.eq_ignore_ascii_case("options") { continue; }
            out.push(RepoEntry {
                kind: "pacman".into(),
                id: id.clone(),
                name: id,
                url: "/etc/pacman.d/mirrorlist".into(),
                enabled,
                source_path: path.display().to_string(),
                gpg_check: Some(true),
                official: false,
            });
        }
    }
    out
}

/* ---------- flatpak ---------- */

fn collect_flatpak() -> Vec<RepoEntry> {
    if which::which("flatpak").is_err() {
        return vec![];
    }
    let out = match timed("flatpak", 8).args(["remotes", "--columns=name,url,disabled"]).output() {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 2 {
                return None;
            }
            let name = parts[0].trim().to_string();
            let url = parts[1].trim().to_string();
            let disabled = parts.get(2).map_or(false, |d| {
                let s = d.trim();
                s == "yes" || s == "true" || s == "1"
            });
            let official = name.eq_ignore_ascii_case("flathub")
                || url.contains("flathub.org");
            Some(RepoEntry {
                kind: "flatpak".into(),
                id: name.clone(),
                name,
                url,
                enabled: !disabled,
                source_path: "flatpak remotes".into(),
                gpg_check: None,
                official,
            })
        })
        .collect()
}
