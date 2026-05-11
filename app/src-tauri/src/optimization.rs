//! Optimizasyon: temizlenebilir alanları tarar ve raporlar.
//!
//! Salt-okunur — hiçbir şeyi silmez/temizlemez (sonraki turda polkit ile).
//! Her kategori için boyut/sayı + önerilen komut + güvenlik etiketi döner.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct OptimizationReport {
    pub categories: Vec<CleanupCategory>,
    pub total_bytes: u64,
    pub native_kind: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct CleanupCategory {
    pub id: String,
    pub label: String,
    pub description: String,
    pub size_bytes: u64,
    pub item_count: Option<u64>,
    pub command: String,
    pub safety: String,        // "safe" | "review" | "manual"
    pub status: String,        // "found" | "empty" | "unsupported"
    pub icon: String,          // glyph
    pub color: String,         // accent
}

pub fn collect() -> OptimizationReport {
    let kind = detect_native_kind();
    let mut categories = vec![
        scan_native_cache(&kind),
        scan_journal(),
        scan_user_cache(),
        scan_thumbnails(),
        scan_tmp(),
        scan_autoremove(&kind),
        scan_flatpak_unused(),
    ];
    categories.retain(|c| c.status != "unsupported" || c.id == "autoremove" || c.id == "native-cache");

    let total_bytes = categories.iter().map(|c| c.size_bytes).sum();
    OptimizationReport { categories, total_bytes, native_kind: kind }
}

fn detect_native_kind() -> String {
    for k in ["apt", "dnf", "pacman", "zypper"] {
        if which::which(k).is_ok() {
            return k.to_string();
        }
    }
    "unknown".to_string()
}

fn dir_size(path: &str) -> u64 {
    fn walk(p: &std::path::Path) -> u64 {
        let Ok(meta) = std::fs::symlink_metadata(p) else { return 0; };
        if meta.is_symlink() {
            return 0;
        }
        if meta.is_file() {
            return meta.len();
        }
        if !meta.is_dir() {
            return 0;
        }
        let Ok(entries) = std::fs::read_dir(p) else { return 0; };
        let mut total = 0u64;
        for e in entries.flatten() {
            total = total.saturating_add(walk(&e.path()));
        }
        total
    }
    walk(std::path::Path::new(path))
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn scan_native_cache(kind: &str) -> CleanupCategory {
    let path = match kind {
        "apt"    => "/var/cache/apt/archives",
        "dnf"    => "/var/cache/dnf",
        "pacman" => "/var/cache/pacman/pkg",
        "zypper" => "/var/cache/zypp/packages",
        _ => "",
    };
    let cmd = match kind {
        "apt"    => "apt-get clean",
        "dnf"    => "dnf clean all",
        "pacman" => "pacman -Sc --noconfirm",
        "zypper" => "zypper clean --all",
        _        => "# bilinmeyen paket yöneticisi",
    };
    if path.is_empty() {
        return CleanupCategory {
            id: "native-cache".into(), label: "Paket önbelleği".into(),
            description: "Paket yöneticisi tespit edilemedi.".into(),
            size_bytes: 0, item_count: None, command: cmd.into(),
            safety: "safe".into(), status: "unsupported".into(),
            icon: "▰".into(), color: "#5a5a6a".into(),
        };
    }
    let size = dir_size(path);
    CleanupCategory {
        id: "native-cache".into(),
        label: format!("{} paket önbelleği", kind.to_uppercase()),
        description: format!("İndirilmiş paket arşivleri ({path}). Yeniden indirilebilirler, silmek güvenli."),
        size_bytes: size,
        item_count: None,
        command: cmd.into(),
        safety: "safe".into(),
        status: if size > 0 { "found".into() } else { "empty".into() },
        icon: "▰".into(),
        color: "#ff0099".into(),
    }
}

fn scan_journal() -> CleanupCategory {
    // journalctl --disk-usage çıktısı: "Archived and active journals take up 384.0M in the file system."
    let mut size = 0u64;
    if let Ok(out) = Command::new("journalctl").arg("--disk-usage").output() {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            size = parse_size_from_journalctl(&text);
        }
    }
    CleanupCategory {
        id: "journal".into(),
        label: "Sistem günlükleri".into(),
        description: "systemd-journald'in tuttuğu kayıt geçmişi. 7 günden eskisini silmek güvenli.".into(),
        size_bytes: size,
        item_count: None,
        command: "journalctl --vacuum-time=7d".into(),
        safety: "safe".into(),
        status: if size > 0 { "found".into() } else { "empty".into() },
        icon: "▤".into(),
        color: "#00f0ff".into(),
    }
}

fn parse_size_from_journalctl(text: &str) -> u64 {
    // try to find number+unit (e.g. "384.0M", "1.2G")
    for line in text.lines() {
        // basit tarama: rakamla başlayan ve M/G/K/B ile biten
        let mut chars = line.split_whitespace();
        while let Some(tok) = chars.next() {
            if let Some(b) = parse_humansize(tok) {
                return b;
            }
        }
    }
    0
}

fn parse_humansize(s: &str) -> Option<u64> {
    // "384.0M", "1.2G", "10K", "512B"
    if s.is_empty() { return None; }
    let (num, unit) = s.split_at(s.find(|c: char| c.is_alphabetic())?);
    let n: f64 = num.parse().ok()?;
    let mul: u64 = match unit.chars().next()?.to_ascii_uppercase() {
        'B' => 1,
        'K' => 1024,
        'M' => 1024 * 1024,
        'G' => 1024 * 1024 * 1024,
        'T' => 1024 * 1024 * 1024 * 1024,
        _ => return None,
    };
    Some((n * mul as f64) as u64)
}

fn scan_user_cache() -> CleanupCategory {
    let path = home().map(|h| h.join(".cache")).map(|p| p.display().to_string()).unwrap_or_default();
    let size = if path.is_empty() { 0 } else { dir_size(&path) };
    CleanupCategory {
        id: "user-cache".into(),
        label: "Kullanıcı önbelleği".into(),
        description: format!("~/.cache altındaki uygulama önbellekleri (tarayıcılar, miniatür önbellekleri, vb.). Silmek genelde güvenli ama uygulama açıkken kapatmak iyi olur."),
        size_bytes: size,
        item_count: None,
        command: "rm -rf ~/.cache/*".into(),
        safety: "review".into(),
        status: if size > 0 { "found".into() } else { "empty".into() },
        icon: "✱".into(),
        color: "#b400ff".into(),
    }
}

fn scan_thumbnails() -> CleanupCategory {
    let path = home().map(|h| h.join(".cache/thumbnails")).map(|p| p.display().to_string()).unwrap_or_default();
    let size = if path.is_empty() { 0 } else { dir_size(&path) };
    CleanupCategory {
        id: "thumbnails".into(),
        label: "Önizleme küçük resimleri".into(),
        description: "Dosya yöneticisinin oluşturduğu thumbnail önbelleği. Sadece görsel; silmek güvenli, gerektikçe yeniden üretilir.".into(),
        size_bytes: size,
        item_count: None,
        command: "rm -rf ~/.cache/thumbnails".into(),
        safety: "safe".into(),
        status: if size > 0 { "found".into() } else { "empty".into() },
        icon: "▥".into(),
        color: "#ffd400".into(),
    }
}

fn scan_tmp() -> CleanupCategory {
    let size = dir_size("/tmp");
    CleanupCategory {
        id: "tmp".into(),
        label: "Geçici dosyalar".into(),
        description: "/tmp altındaki geçici dosyalar. Çoğu uygulama her açılışta kendi tmp'sini yönetir; manuel silinmemeli, sadece açık uygulamalar yokken.".into(),
        size_bytes: size,
        item_count: None,
        command: "# /tmp'i el ile temizleme önerilmez — sistem yeniden başladığında zaten temizlenir.".into(),
        safety: "manual".into(),
        status: if size > 0 { "found".into() } else { "empty".into() },
        icon: "▭".into(),
        color: "#5a5a6a".into(),
    }
}

fn scan_autoremove(kind: &str) -> CleanupCategory {
    let (count, cmd) = match kind {
        "apt" => (
            count_apt_autoremovable(),
            "apt-get autoremove --purge -y",
        ),
        "dnf" => (
            // -C / --cacheonly: cache yeter, ağa gitme
            count_lines_filtered(
                Command::new("dnf")
                    .args(["repoquery", "--unneeded", "-q", "-C"])
                    .env("LC_ALL", "C"),
                |l| !l.is_empty() && !l.starts_with("Last metadata") && !l.starts_with("Warning"),
            ),
            "dnf autoremove -y",
        ),
        "pacman" => (
            count_lines_filtered(
                Command::new("pacman").args(["-Qdtq"]),
                |l| !l.is_empty(),
            ),
            "pacman -Rns $(pacman -Qdtq)",
        ),
        "zypper" => (
            // zypper -q packages --orphaned tablo verir; başlık + alt çizgi atlanmalı.
            count_lines_filtered(
                Command::new("zypper").args(["-q", "packages", "--orphaned"]).env("LC_ALL", "C"),
                |l| l.starts_with("i") || l.starts_with("v"),
            ),
            "zypper rm $(zypper -q packages --orphaned | awk '/^i/ {print $5}')",
        ),
        _ => (None, "# bilinmeyen paket yöneticisi"),
    };
    let n = count.unwrap_or(0);
    CleanupCategory {
        id: "autoremove".into(),
        label: "Yetim paketler".into(),
        description: "Bağımlılık olarak kurulup artık hiçbir paketin gerek duymadığı paketler. Kaldırmak güvenlidir.".into(),
        size_bytes: 0,
        item_count: Some(n),
        command: cmd.into(),
        safety: "review".into(),
        status: if n > 0 { "found".into() } else { "empty".into() },
        icon: "✕".into(),
        color: "#ff4477".into(),
    }
}

/// `apt-get -s autoremove` simülasyonunu çalıştırıp "X to remove" sayısını okur.
/// Yetki gerektirmez, hiçbir paketi gerçekten kaldırmaz.
fn count_apt_autoremovable() -> Option<u64> {
    let out = Command::new("apt-get")
        .args(["-s", "autoremove"])
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        // örnek: "0 upgraded, 0 newly installed, 14 to remove and 0 not upgraded."
        if !line.contains("to remove") {
            continue;
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            if *w == "to" && words.get(i + 1) == Some(&"remove") && i > 0 {
                if let Ok(n) = words[i - 1].parse::<u64>() {
                    return Some(n);
                }
            }
        }
    }
    Some(0)
}

fn count_lines_filtered(cmd: &mut Command, f: impl Fn(&str) -> bool) -> Option<u64> {
    let out = cmd.output().ok()?;
    if !out.status.success() { return None; }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.lines().filter(|l| f(l.trim())).count() as u64)
}

fn scan_flatpak_unused() -> CleanupCategory {
    let installed = which::which("flatpak").is_ok();
    if !installed {
        return CleanupCategory {
            id: "flatpak-unused".into(),
            label: "Kullanılmayan Flatpak runtime'ları".into(),
            description: "Flatpak kurulu değil — atlandı.".into(),
            size_bytes: 0,
            item_count: None,
            command: "flatpak uninstall --unused -y".into(),
            safety: "safe".into(),
            status: "unsupported".into(),
            icon: "◐".into(),
            color: "#5a5a6a".into(),
        };
    }
    // dry run: hangi runtime'lar gereksiz?
    let count = count_lines_filtered(
        Command::new("flatpak").args(["uninstall", "--unused", "--dry-run"]),
        |l| l.starts_with(' ') && l.contains('/'),
    );
    let n = count.unwrap_or(0);
    CleanupCategory {
        id: "flatpak-unused".into(),
        label: "Kullanılmayan Flatpak runtime'ları".into(),
        description: "Hiçbir Flatpak uygulaması tarafından kullanılmayan ortak çalışma zamanları.".into(),
        size_bytes: 0,
        item_count: Some(n),
        command: "flatpak uninstall --unused -y".into(),
        safety: "safe".into(),
        status: if n > 0 { "found".into() } else { "empty".into() },
        icon: "◐".into(),
        color: "#00f0ff".into(),
    }
}
