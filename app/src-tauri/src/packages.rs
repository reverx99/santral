//! Paket yönetimi durumu: native paket yöneticisi (apt/dnf/pacman/zypper),
//! flatpak ve snap'in kurulu olup olmadığı, sürümleri, kurulu paket sayıları
//! ve flatpak için yapılandırılmış uzak depoların (remotes) listesi.
//!
//! Salt-okunur — kurulum/aktivasyon yok (sonraki fazda polkit ile).

use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct PackageOverview {
    pub native: NativePM,
    pub flatpak: FlatpakStatus,
    pub snap: SnapStatus,
    pub recommendations: Vec<Recommendation>,
}

#[derive(Serialize, Clone, Debug)]
pub struct NativePM {
    pub kind: String,
    pub installed: bool,
    pub version: Option<String>,
    pub installed_count: Option<u64>,
    pub repo_config_path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FlatpakStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub remotes: Vec<FlatpakRemote>,
    pub installed_count: Option<u64>,
    pub has_flathub: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct FlatpakRemote {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SnapStatus {
    pub installed: bool,
    pub service_active: bool,
    pub version: Option<String>,
    pub installed_count: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Recommendation {
    pub id: String,
    pub severity: String,         // "info" | "warn" | "good"
    pub title: String,
    pub body: String,
    pub action_label: Option<String>,
    pub action_command: Option<String>, // sonraki fazda polkit ile çalıştırılacak
}

pub fn collect() -> PackageOverview {
    let kind = detect_native_kind();
    let native = NativePM {
        installed: kind != "unknown",
        version: native_version(&kind),
        installed_count: native_count(&kind),
        repo_config_path: native_repo_path(&kind),
        kind: kind.clone(),
    };

    let flatpak = collect_flatpak();
    let snap = collect_snap();
    let recommendations = build_recommendations(&native, &flatpak, &snap);

    PackageOverview { native, flatpak, snap, recommendations }
}

fn detect_native_kind() -> String {
    for kind in ["apt", "dnf", "pacman", "zypper"] {
        if which::which(kind).is_ok() {
            return kind.to_string();
        }
    }
    "unknown".to_string()
}

fn run_first_line(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    text.lines().next().map(|s| s.trim().to_string())
}

fn native_version(kind: &str) -> Option<String> {
    if kind == "unknown" {
        return None;
    }
    run_first_line(kind, &["--version"])
}

fn native_count(kind: &str) -> Option<u64> {
    let out = match kind {
        "apt"    => Command::new("dpkg-query").args(["-f=.\n", "-W"]).output().ok()?,
        "dnf"    => Command::new("rpm").args(["-qa"]).output().ok()?,
        "pacman" => Command::new("pacman").args(["-Q"]).output().ok()?,
        "zypper" => Command::new("rpm").args(["-qa"]).output().ok()?,
        _ => return None,
    };
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.lines().filter(|l| !l.trim().is_empty()).count() as u64)
}

fn native_repo_path(kind: &str) -> Option<String> {
    Some(match kind {
        "apt"    => "/etc/apt/sources.list.d/",
        "dnf"    => "/etc/yum.repos.d/",
        "pacman" => "/etc/pacman.conf",
        "zypper" => "/etc/zypp/repos.d/",
        _ => return None,
    }.to_string())
}

fn collect_flatpak() -> FlatpakStatus {
    if which::which("flatpak").is_err() {
        return FlatpakStatus {
            installed: false,
            version: None,
            remotes: vec![],
            installed_count: None,
            has_flathub: false,
        };
    }
    let version = run_first_line("flatpak", &["--version"]);
    let remotes = list_flatpak_remotes();
    let has_flathub = remotes.iter().any(|r| {
        r.name.eq_ignore_ascii_case("flathub")
            || r.url.contains("flathub.org")
    });
    let installed_count = flatpak_app_count();
    FlatpakStatus {
        installed: true,
        version,
        remotes,
        installed_count,
        has_flathub,
    }
}

fn list_flatpak_remotes() -> Vec<FlatpakRemote> {
    let out = match Command::new("flatpak")
        .args(["remotes", "--columns=name,url"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                Some(FlatpakRemote {
                    name: parts[0].trim().to_string(),
                    url: parts[1].trim().to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

fn flatpak_app_count() -> Option<u64> {
    let out = Command::new("flatpak")
        .args(["list", "--app", "--columns=application"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.lines().filter(|l| !l.trim().is_empty()).count() as u64)
}

fn collect_snap() -> SnapStatus {
    if which::which("snap").is_err() {
        return SnapStatus {
            installed: false,
            service_active: false,
            version: None,
            installed_count: None,
        };
    }
    let version = run_first_line("snap", &["--version"]);
    let service_active = Command::new("systemctl")
        .args(["is-active", "snapd"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "active")
        .unwrap_or(false);
    let installed_count = snap_count();
    SnapStatus {
        installed: true,
        service_active,
        version,
        installed_count,
    }
}

fn snap_count() -> Option<u64> {
    let out = Command::new("snap").args(["list"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // ilk satır başlık, atla
    let n = text.lines().skip(1).filter(|l| !l.trim().is_empty()).count();
    Some(n as u64)
}

fn build_recommendations(
    native: &NativePM,
    flatpak: &FlatpakStatus,
    snap: &SnapStatus,
) -> Vec<Recommendation> {
    let mut out = vec![];

    if !flatpak.installed {
        out.push(Recommendation {
            id: "install-flatpak".into(),
            severity: "warn".into(),
            title: "Flatpak kurulu değil".into(),
            body: "Çoğu modern uygulama (Discord, Spotify, Bitwarden, ...) Flatpak üzerinden dağıtılıyor. Tek tıkla kuralım, Flathub'ı da ekleyelim.".into(),
            action_label: Some("Flatpak'i kur".into()),
            action_command: Some(install_command(&native.kind, "flatpak")),
        });
    } else if !flatpak.has_flathub {
        out.push(Recommendation {
            id: "add-flathub".into(),
            severity: "warn".into(),
            title: "Flathub eklenmemiş".into(),
            body: "Flatpak kurulu ama Flathub uzak deposu yapılandırılmamış. Flatpak uygulamalarının çoğu oradan geliyor.".into(),
            action_label: Some("Flathub'ı ekle".into()),
            action_command: Some(
                "flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo".into(),
            ),
        });
    } else {
        out.push(Recommendation {
            id: "flatpak-ok".into(),
            severity: "good".into(),
            title: "Flatpak hazır".into(),
            body: format!(
                "Flathub bağlı. Şu an {} uygulama kurulu.",
                flatpak.installed_count.unwrap_or(0)
            ),
            action_label: None,
            action_command: None,
        });
    }

    if !snap.installed {
        out.push(Recommendation {
            id: "snap-optional".into(),
            severity: "info".into(),
            title: "Snap kurulu değil (opsiyonel)".into(),
            body: "Snap, Canonical'ın paket biçimi. Linux üzerinde Flatpak'e göre daha az popüler ama bazı uygulamalar (Spotify, Postman) burada bulunur.".into(),
            action_label: Some("Snap'i kur (opsiyonel)".into()),
            action_command: Some(install_command(&native.kind, "snapd")),
        });
    } else if !snap.service_active {
        out.push(Recommendation {
            id: "snapd-inactive".into(),
            severity: "warn".into(),
            title: "snapd servisi aktif değil".into(),
            body: "Snap kurulu fakat snapd servisi çalışmıyor. Uygulama kurulumu için açılması gerekir.".into(),
            action_label: Some("snapd'yi başlat".into()),
            action_command: Some("systemctl enable --now snapd".into()),
        });
    }

    out
}

fn install_command(native_kind: &str, package: &str) -> String {
    match native_kind {
        "apt"    => format!("apt install -y {package}"),
        "dnf"    => format!("dnf install -y {package}"),
        "pacman" => format!("pacman -S --noconfirm {package}"),
        "zypper" => format!("zypper install -y {package}"),
        _        => format!("# bilinmeyen paket yöneticisi — manuel kurulum: {package}"),
    }
}
