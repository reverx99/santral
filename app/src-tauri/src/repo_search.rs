//! Repo arama: native paket yöneticisinden ve flatpak'tan canlı arama.
//! Hepsi salt-okunur arama komutları; ağ erişimi olabilir (flatpak için
//! ağ gerekir, dnf cache yeter, apt-cache offline).

use crate::util::timed;
use serde::Serialize;
use std::time::Instant;

#[derive(Serialize, Clone, Debug)]
pub struct SearchResults {
    pub query: String,
    pub native: Vec<SearchHit>,
    pub flatpak: Vec<SearchHit>,
    pub native_source: String,
    pub elapsed_ms: u64,
    pub limit: u32,
    pub truncated: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchHit {
    pub source: String,            // "apt" | "dnf" | "pacman" | "zypper" | "flatpak"
    pub name: String,              // paket adı / application id
    pub label: Option<String>,     // okunabilir ad (flatpak'ta)
    pub version: Option<String>,
    pub summary: Option<String>,
    pub remote: Option<String>,    // flatpak remote / pacman repo
}

const LIMIT: u32 = 60;

pub fn search(query: &str) -> SearchResults {
    let started = Instant::now();
    let q = query.trim().to_string();
    let kind = detect_native_kind();
    let native_source = kind.clone();

    let (native, native_trunc) = if q.len() < 2 {
        (vec![], false)
    } else {
        match kind.as_str() {
            "apt"    => search_apt(&q),
            "dnf"    => search_dnf(&q),
            "pacman" => search_pacman(&q),
            "zypper" => search_zypper(&q),
            _        => (vec![], false),
        }
    };

    let (flatpak, flatpak_trunc) = if q.len() < 2 {
        (vec![], false)
    } else {
        search_flatpak(&q)
    };

    SearchResults {
        query: q,
        native,
        flatpak,
        native_source,
        elapsed_ms: started.elapsed().as_millis() as u64,
        limit: LIMIT,
        truncated: native_trunc || flatpak_trunc,
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

fn cap(mut hits: Vec<SearchHit>) -> (Vec<SearchHit>, bool) {
    let trunc = hits.len() > LIMIT as usize;
    hits.truncate(LIMIT as usize);
    (hits, trunc)
}

fn search_apt(q: &str) -> (Vec<SearchHit>, bool) {
    let Ok(out) = timed("apt-cache", 30)
        .args(["search", "--names-only", q])
        .output()
    else {
        return (vec![], false);
    };
    if !out.status.success() {
        return (vec![], false);
    }
    let hits: Vec<SearchHit> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let (name, summary) = l.split_once(" - ")?;
            Some(SearchHit {
                source: "apt".into(),
                name: name.trim().to_string(),
                label: None,
                version: None,
                summary: Some(summary.trim().to_string()),
                remote: None,
            })
        })
        .collect();
    cap(hits)
}

fn search_dnf(q: &str) -> (Vec<SearchHit>, bool) {
    let Ok(out) = timed("dnf", 30)
        .args(["search", "-q", "-C", q])
        .output()
    else {
        return (vec![], false);
    };
    if !out.status.success() {
        return (vec![], false);
    }
    let hits: Vec<SearchHit> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| {
            let l = l.trim();
            !l.is_empty()
                && !l.starts_with("==")
                && !l.starts_with("Last metadata")
                && !l.starts_with("Warning")
        })
        .filter_map(|l| {
            let (name_arch, summary) = l.split_once(" : ")?;
            let name = name_arch.split('.').next().unwrap_or(name_arch).trim();
            Some(SearchHit {
                source: "dnf".into(),
                name: name.to_string(),
                label: None,
                version: None,
                summary: Some(summary.trim().to_string()),
                remote: None,
            })
        })
        .collect();
    cap(hits)
}

fn search_pacman(q: &str) -> (Vec<SearchHit>, bool) {
    let Ok(out) = timed("pacman", 15).args(["-Ss", q]).output() else {
        return (vec![], false);
    };
    if !out.status.success() {
        return (vec![], false);
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let mut hits = Vec::new();
    let mut iter = text.lines().peekable();
    while let Some(line) = iter.next() {
        if line.is_empty() || line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let head: Vec<&str> = line.split_whitespace().collect();
        if head.is_empty() {
            continue;
        }
        let repo_pkg = head[0];
        let version = head.get(1).map(|s| s.trim_end_matches(']').to_string());
        let (remote, name) = match repo_pkg.split_once('/') {
            Some((r, n)) => (Some(r.to_string()), n.to_string()),
            None => (None, repo_pkg.to_string()),
        };
        let summary = match iter.peek() {
            Some(l) if l.starts_with(' ') || l.starts_with('\t') => Some(l.trim().to_string()),
            _ => None,
        };
        if summary.is_some() {
            iter.next();
        }
        hits.push(SearchHit {
            source: "pacman".into(),
            name, label: None, version, summary, remote,
        });
    }
    cap(hits)
}

fn search_zypper(q: &str) -> (Vec<SearchHit>, bool) {
    let Ok(out) = timed("zypper", 30).args(["-q", "se", q]).output() else {
        return (vec![], false);
    };
    if !out.status.success() {
        return (vec![], false);
    }
    let hits: Vec<SearchHit> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let parts: Vec<&str> = l.split('|').map(|s| s.trim()).collect();
            if parts.len() < 3 {
                return None;
            }
            if parts[1].eq_ignore_ascii_case("Name") || parts[1].starts_with('-') {
                return None;
            }
            Some(SearchHit {
                source: "zypper".into(),
                name: parts[1].to_string(),
                label: None,
                version: None,
                summary: Some(parts[2].to_string()),
                remote: None,
            })
        })
        .collect();
    cap(hits)
}

fn search_flatpak(q: &str) -> (Vec<SearchHit>, bool) {
    if which::which("flatpak").is_err() {
        return (vec![], false);
    }
    let Ok(out) = timed("flatpak", 30)
        .args(["search", "--columns=application,name,description,remotes,version", q])
        .output()
    else {
        return (vec![], false);
    };
    if !out.status.success() {
        return (vec![], false);
    }
    let hits: Vec<SearchHit> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.contains("No matches found"))
        .filter_map(|l| {
            let parts: Vec<&str> = l.split('\t').collect();
            if parts.len() < 2 {
                return None;
            }
            let summary = parts.get(2).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let remote  = parts.get(3).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let version = parts.get(4).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            Some(SearchHit {
                source: "flatpak".into(),
                name: parts[0].trim().to_string(),
                label: Some(parts[1].trim().to_string()),
                summary,
                remote,
                version,
            })
        })
        .collect();
    cap(hits)
}
