//! Aksiyon altyapısı — uzun süren komutları arka planda çalıştırır, canlı
//! stdout/stderr satırlarını Tauri eventleri olarak frontend'e iletir.
//!
//! Güvenlik prensipleri:
//! 1) ALLOWLIST: Frontend rastgele komut çalıştıramaz; her aksiyon `kind`
//!    burada açıkça tanımlıdır, yalnızca alt parametre değerleri geçer.
//! 2) ARGÜMAN SANITIZASYONU: appid/url/name'ler regex'le doğrulanır,
//!    hiçbir argüman kabuğa geçmez (Command::args() doğrudan execve).
//! 3) DRY-RUN: `dry_run: true` ise komut çalıştırılmaz, sadece ne
//!    çalıştırılacağı log'a yazılır.
//! 4) FAZ 7.1 KAPSAMI: sadece kullanıcı yetkisi gerektirmeyen
//!    (flatpak --user, echo) aksiyonlar. Root gerektirenler Faz 7.2'de
//!    pkexec/polkit ile.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Aynı anda yalnızca bir native paket yöneticisi (apt/dnf/pacman/zypper)
/// çalışsın — dpkg/dnf lock çakışmasını önler. Flatpak --user paralel
/// çalışabilir, kilitten muaftır.
static NATIVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    /// Aksiyon türü, allowlist'te tanımlı bir anahtar
    pub kind: String,
    /// Aksiyonun parametreleri (uygulama id'si, repo url'i, vs.)
    #[serde(default)]
    pub args: Vec<String>,
    /// İnsan-okur etiketi (UI'da gösterilecek)
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: u32,
    pub kind: String,
    pub label: String,
    pub status: String, // "queued" | "running" | "succeeded" | "failed" | "cancelled" | "rejected"
    pub command: String,
    pub args: Vec<String>,
    pub dry_run: bool,
    pub needs_root: bool,
    pub needs_native_lock: bool,
    pub started_at: u64,
    pub queued_at: u64,
    pub ended_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub log_count: u32,
    pub error: Option<String>,
    /// Çalışan task'lar için OS PID — cancel_task SIGTERM göndermek için kullanır.
    #[serde(default)]
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub task_id: u32,
    pub level: String, // "out" | "err" | "info" | "dry-run"
    pub text: String,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// Tüm task'ların state'i (bellek içi). Uygulama yeniden başlayınca kaybolur.
fn tasks() -> &'static Mutex<HashMap<u32, Task>> {
    use std::sync::OnceLock;
    static TASKS: OnceLock<Mutex<HashMap<u32, Task>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn update_task(id: u32, app: &AppHandle, f: impl FnOnce(&mut Task)) {
    if let Ok(mut map) = tasks().lock() {
        if let Some(t) = map.get_mut(&id) {
            f(t);
            let _ = app.emit("task:update", t.clone());
        }
    }
}

/// Bir komutu çözen "resolved" output. `program` çalıştırılacak ikili,
/// `args` execve'ye geçecek argümanlar (shell yok), `needs_root` true ise
/// pkexec ile sarmalanmıştır, `needs_native_lock` true ise NATIVE_LOCK
/// alınana kadar bekleyecek.
struct Resolved {
    program: String,
    args: Vec<String>,
    needs_root: bool,
    needs_native_lock: bool,
}

/// ----- ALLOWLIST -----
/// Bir ActionRequest'i Resolved'a çevirir. Bu fonksiyon TEK güven sınırıdır —
/// burada validate edilen değerler dış dünyaya geçer. Bilinmeyen `kind` → Err.
fn resolve_command(req: &ActionRequest) -> Result<Resolved, String> {
    match req.kind.as_str() {

        // ============= FLATPAK (--user, root yok) =============

        "flatpak.user.install" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec![
                "install".into(), "--user".into(),
                "--noninteractive".into(), "--assumeyes".into(),
            ];
            a.extend(pkgs);
            Ok(Resolved {
                program: "flatpak".into(),
                args: a,
                needs_root: false, needs_native_lock: false,
            })
        }
        "flatpak.user.uninstall" => {
            let app_id = req.args.first().ok_or("eksik appid")?;
            check_appid(app_id)?;
            Ok(Resolved {
                program: "flatpak".into(),
                args: vec![
                    "uninstall".into(), "--user".into(),
                    "--noninteractive".into(), "--assumeyes".into(),
                    app_id.clone(),
                ],
                needs_root: false, needs_native_lock: false,
            })
        }
        "flatpak.user.uninstall-unused" => Ok(Resolved {
            program: "flatpak".into(),
            args: vec![
                "uninstall".into(), "--user".into(), "--unused".into(),
                "--noninteractive".into(), "--assumeyes".into(),
            ],
            needs_root: false, needs_native_lock: false,
        }),
        "flatpak.user.remote-add" => {
            let name = req.args.first().ok_or("eksik remote adı")?;
            let url = req.args.get(1).ok_or("eksik url")?;
            check_remote_name(name)?;
            check_https_url(url)?;
            Ok(Resolved {
                program: "flatpak".into(),
                args: vec![
                    "remote-add".into(), "--user".into(), "--if-not-exists".into(),
                    name.clone(), url.clone(),
                ],
                needs_root: false, needs_native_lock: false,
            })
        }

        // ============= NATIVE INSTALL (root via pkexec) =============

        "apt.install" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec![
                "env".into(), "DEBIAN_FRONTEND=noninteractive".into(),
                "apt-get".into(), "install".into(), "-y".into(),
            ];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "apt.autoremove" => Ok(pkexec_wrap(vec![
            "env".into(), "DEBIAN_FRONTEND=noninteractive".into(),
            "apt-get".into(), "autoremove".into(), "--purge".into(), "-y".into(),
        ], true)),
        "apt.clean" => Ok(pkexec_wrap(vec![
            "apt-get".into(), "clean".into(),
        ], true)),

        "dnf.install" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec!["dnf".into(), "install".into(), "-y".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "dnf.autoremove" => Ok(pkexec_wrap(vec![
            "dnf".into(), "autoremove".into(), "-y".into(),
        ], true)),
        "dnf.clean" => Ok(pkexec_wrap(vec![
            "dnf".into(), "clean".into(), "all".into(),
        ], true)),

        "pacman.install" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec!["pacman".into(), "-S".into(), "--noconfirm".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "pacman.autoremove" => {
            // pacman orphan listesi yoksa hata vermesin — sh -c kullanmamak için
            // pacman'in kendi -Rns mekanizmasını kullan. Boş listede başarısız
            // olabilir; UI bunu graceful gösterir.
            Ok(pkexec_wrap(vec![
                "sh".into(), "-c".into(),
                "pacman -Qdtq 2>/dev/null | xargs -r pacman -Rns --noconfirm".into(),
            ], true))
        }
        "pacman.clean" => Ok(pkexec_wrap(vec![
            "pacman".into(), "-Sc".into(), "--noconfirm".into(),
        ], true)),

        "zypper.install" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec!["zypper".into(), "install".into(), "-y".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "zypper.autoremove" => Ok(pkexec_wrap(vec![
            "zypper".into(), "rm".into(), "--clean-deps".into(), "-y".into(),
        ], true)),
        "zypper.clean" => Ok(pkexec_wrap(vec![
            "zypper".into(), "clean".into(), "--all".into(),
        ], true)),

        "snap.install" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec!["snap".into(), "install".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, false))
        }

        // ============= NATIVE REMOVE / UNINSTALL (root) =============

        "apt.remove" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec![
                "env".into(), "DEBIAN_FRONTEND=noninteractive".into(),
                "apt-get".into(), "remove".into(), "-y".into(),
            ];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "apt.purge" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec![
                "env".into(), "DEBIAN_FRONTEND=noninteractive".into(),
                "apt-get".into(), "purge".into(), "-y".into(),
            ];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "dnf.remove" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec!["dnf".into(), "remove".into(), "-y".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "pacman.remove" => {
            let pkgs = check_pkglist(&req.args)?;
            // -R: kaldır, -n: yapılandırma dosyalarını da sil, -s: artık gereksiz deps
            let mut a: Vec<String> = vec!["pacman".into(), "-Rns".into(), "--noconfirm".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "zypper.remove" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec![
                "zypper".into(), "remove".into(), "-y".into(),
                "--clean-deps".into(),
            ];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, true))
        }
        "snap.remove" => {
            let pkgs = check_pkglist(&req.args)?;
            let mut a: Vec<String> = vec!["snap".into(), "remove".into()];
            a.extend(pkgs);
            Ok(pkexec_wrap(a, false))
        }

        // ============= UPGRADE / SYSTEM UPDATE (root) =============

        "apt.upgrade" => Ok(pkexec_wrap(vec![
            "env".into(), "DEBIAN_FRONTEND=noninteractive".into(),
            "apt-get".into(), "upgrade".into(), "-y".into(),
        ], true)),
        "apt.dist-upgrade" => Ok(pkexec_wrap(vec![
            "env".into(), "DEBIAN_FRONTEND=noninteractive".into(),
            "apt-get".into(), "dist-upgrade".into(), "-y".into(),
        ], true)),
        "apt.update" => Ok(pkexec_wrap(vec![
            "apt-get".into(), "update".into(),
        ], true)),
        "dnf.upgrade" => Ok(pkexec_wrap(vec![
            "dnf".into(), "upgrade".into(), "-y".into(),
        ], true)),
        "pacman.upgrade" => Ok(pkexec_wrap(vec![
            "pacman".into(), "-Syu".into(), "--noconfirm".into(),
        ], true)),
        "zypper.upgrade" => Ok(pkexec_wrap(vec![
            "zypper".into(), "update".into(), "-y".into(),
        ], true)),
        "flatpak.user.update" => Ok(Resolved {
            program: "flatpak".into(),
            args: vec![
                "update".into(), "--user".into(),
                "--noninteractive".into(), "--assumeyes".into(),
            ],
            needs_root: false, needs_native_lock: false,
        }),
        "snap.refresh" => Ok(pkexec_wrap(vec![
            "snap".into(), "refresh".into(),
        ], false)),

        // ============= REPO ENABLE / DISABLE / REMOVE =============

        "dnf.repo-enable" => {
            let id = req.args.first().ok_or("eksik repo id")?;
            check_repo_id(id)?;
            Ok(pkexec_wrap(vec![
                "dnf".into(), "config-manager".into(),
                "--set-enabled".into(), id.clone(),
            ], true))
        }
        "dnf.repo-disable" => {
            let id = req.args.first().ok_or("eksik repo id")?;
            check_repo_id(id)?;
            Ok(pkexec_wrap(vec![
                "dnf".into(), "config-manager".into(),
                "--set-disabled".into(), id.clone(),
            ], true))
        }
        "zypper.repo-enable" => {
            let id = req.args.first().ok_or("eksik repo id")?;
            check_repo_id(id)?;
            Ok(pkexec_wrap(vec![
                "zypper".into(), "modifyrepo".into(),
                "--enable".into(), id.clone(),
            ], true))
        }
        "zypper.repo-disable" => {
            let id = req.args.first().ok_or("eksik repo id")?;
            check_repo_id(id)?;
            Ok(pkexec_wrap(vec![
                "zypper".into(), "modifyrepo".into(),
                "--disable".into(), id.clone(),
            ], true))
        }
        "flatpak.user.remote-modify-enable" => {
            let name = req.args.first().ok_or("eksik remote adı")?;
            check_remote_name(name)?;
            Ok(Resolved {
                program: "flatpak".into(),
                args: vec!["remote-modify".into(), "--user".into(), "--enable".into(), name.clone()],
                needs_root: false, needs_native_lock: false,
            })
        }
        "flatpak.user.remote-modify-disable" => {
            let name = req.args.first().ok_or("eksik remote adı")?;
            check_remote_name(name)?;
            Ok(Resolved {
                program: "flatpak".into(),
                args: vec!["remote-modify".into(), "--user".into(), "--disable".into(), name.clone()],
                needs_root: false, needs_native_lock: false,
            })
        }
        // --- APT repo dosya yönetimi (sources.list.d) ---
        "apt.repo-file-disable" => {
            let path = req.args.first().ok_or("eksik dosya yolu")?;
            check_apt_sources_path(path)?;
            if path.ends_with(".disabled") {
                return Err("dosya zaten devre dışı".into());
            }
            Ok(pkexec_wrap(vec![
                "mv".into(), path.clone(), format!("{path}.disabled"),
            ], true))
        }
        "apt.repo-file-enable" => {
            let path = req.args.first().ok_or("eksik dosya yolu")?;
            check_apt_sources_path(path)?;
            let target = path.strip_suffix(".disabled")
                .ok_or("dosya zaten etkin (sonu .disabled değil)")?;
            Ok(pkexec_wrap(vec![
                "mv".into(), path.clone(), target.to_string(),
            ], true))
        }
        "apt.repo-file-remove" => {
            let path = req.args.first().ok_or("eksik dosya yolu")?;
            check_apt_sources_path(path)?;
            Ok(pkexec_wrap(vec!["rm".into(), path.clone()], true))
        }
        "apt.repo-add-ppa" => {
            let ppa = req.args.first().ok_or("eksik PPA")?;
            check_ppa(ppa)?;
            Ok(pkexec_wrap(vec![
                "add-apt-repository".into(), "-y".into(), ppa.clone(),
            ], true))
        }

        // --- DNF repo dosya yönetimi (yum.repos.d) ---
        "dnf.repo-file-remove" => {
            let path = req.args.first().ok_or("eksik dosya yolu")?;
            check_dnf_repos_path(path)?;
            Ok(pkexec_wrap(vec!["rm".into(), path.clone()], true))
        }
        "dnf.repo-add" => {
            let url = req.args.first().ok_or("eksik URL")?;
            check_https_url(url)?;
            Ok(pkexec_wrap(vec![
                "dnf".into(), "config-manager".into(),
                "--add-repo".into(), url.clone(),
            ], true))
        }

        // --- Zypper repo dosya yönetimi (zypp/repos.d) ---
        "zypper.repo-file-remove" => {
            let path = req.args.first().ok_or("eksik dosya yolu")?;
            check_zypper_repos_path(path)?;
            Ok(pkexec_wrap(vec!["rm".into(), path.clone()], true))
        }
        "zypper.repo-add" => {
            let url = req.args.first().ok_or("eksik URL")?;
            let name = req.args.get(1).ok_or("eksik repo adı")?;
            check_https_url(url)?;
            check_repo_id(name)?;
            Ok(pkexec_wrap(vec![
                "zypper".into(), "addrepo".into(), "--refresh".into(),
                url.clone(), name.clone(),
            ], true))
        }

        "flatpak.user.remote-delete" => {
            let name = req.args.first().ok_or("eksik remote adı")?;
            check_remote_name(name)?;
            Ok(Resolved {
                program: "flatpak".into(),
                args: vec!["remote-delete".into(), "--user".into(), "--force".into(), name.clone()],
                needs_root: false, needs_native_lock: false,
            })
        }

        // ============= GÜVENLİK TARAYICILARI =============

        "scanner.chkrootkit" => Ok(pkexec_wrap(vec![
            "chkrootkit".into(), "-q".into(),
        ], false)),
        "scanner.rkhunter" => Ok(pkexec_wrap(vec![
            "rkhunter".into(), "--check".into(),
            "--skip-keypress".into(), "--nocolors".into(),
        ], false)),
        "scanner.clamav" => {
            // varsayılan: kullanıcı home dizini; çağıran path verirse onu kullan
            let default_path = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            let path = req.args.first().cloned().unwrap_or(default_path);
            check_fs_path(&path)?;
            Ok(Resolved {
                program: "clamscan".into(),
                args: vec![
                    "-r".into(), "--bell".into(), "-i".into(),
                    "--no-summary".into(), path,
                ],
                needs_root: false, needs_native_lock: false,
            })
        }
        "scanner.maldet" => Ok(pkexec_wrap(vec![
            "maldet".into(), "-a".into(), "/home".into(),
        ], false)),
        "scanner.lynis" => Ok(pkexec_wrap(vec![
            "lynis".into(), "audit".into(), "system".into(),
            "--quick".into(), "--no-colors".into(),
        ], false)),
        "scanner.aide" => Ok(pkexec_wrap(vec![
            "aide".into(), "--check".into(),
        ], false)),
        "scanner.debsums" => Ok(pkexec_wrap(vec![
            "debsums".into(), "-c".into(),
        ], false)),
        "scanner.rpm-verify" => Ok(pkexec_wrap(vec![
            "rpm".into(), "-Va".into(),
        ], false)),

        // ============= SYSTEM MAINTENANCE (root) =============

        "journalctl.vacuum-time" => {
            // örn. "7d", "30d"
            let duration = req.args.first().cloned().unwrap_or_else(|| "7d".into());
            check_vacuum_duration(&duration)?;
            Ok(pkexec_wrap(vec![
                "journalctl".into(),
                format!("--vacuum-time={duration}"),
            ], false))
        }

        // ============= TEST =============
        "noop.echo" => {
            let msg = req.args.first().cloned().unwrap_or_else(|| "merhaba".into());
            if msg.len() > 200 {
                return Err("echo mesajı çok uzun".into());
            }
            Ok(Resolved {
                program: "echo".into(), args: vec![msg],
                needs_root: false, needs_native_lock: false,
            })
        }

        _ => Err(format!("bilinmeyen aksiyon: {}", req.kind)),
    }
}

/// Yardımcı: bir komutu pkexec ile sarmala. Native PM ise NATIVE_LOCK alır.
fn pkexec_wrap(inner: Vec<String>, native_lock: bool) -> Resolved {
    Resolved {
        program: "pkexec".into(),
        args: inner,
        needs_root: true,
        needs_native_lock: native_lock,
    }
}

fn check_appid(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 256 {
        return Err("geçersiz uygulama kimliği".into());
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '/')) {
        return Err("uygulama kimliğinde geçersiz karakter".into());
    }
    Ok(())
}

fn check_remote_name(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 64 {
        return Err("geçersiz remote adı".into());
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("remote adında geçersiz karakter".into());
    }
    Ok(())
}

fn check_https_url(s: &str) -> Result<(), String> {
    if !s.starts_with("https://") {
        return Err("URL https:// ile başlamalı".into());
    }
    if s.len() > 1024 || s.contains(' ') || s.contains('\n') || s.contains('`') || s.contains('$') {
        return Err("URL'de geçersiz karakter".into());
    }
    Ok(())
}

fn check_pkgname(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 256 {
        return Err("geçersiz paket adı".into());
    }
    // apt/dnf/pacman/zypper paket adları + flatpak appid'leri (org.foo.Bar):
    // harf/rakam, . - _ + : / nadir
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+' | ':' | '/')) {
        return Err("paket adında geçersiz karakter".into());
    }
    if s.contains("..") || s.starts_with('-') {
        return Err("paket adı şüpheli".into());
    }
    Ok(())
}

/// Bir liste paket adını doğrular, geçerli olanları döner.
fn check_pkglist(args: &[String]) -> Result<Vec<String>, String> {
    if args.is_empty() {
        return Err("eksik paket adı".into());
    }
    if args.len() > 100 {
        return Err("aynı anda en çok 100 paket kabul edilir".into());
    }
    for p in args {
        check_pkgname(p)?;
    }
    Ok(args.to_vec())
}

fn check_vacuum_duration(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 16 {
        return Err("geçersiz süre".into());
    }
    // örn. "1d", "30d", "2weeks", "12h"
    if !s.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("süre formatı uygun değil (örn. 7d)".into());
    }
    Ok(())
}

fn check_repo_id(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 128 {
        return Err("geçersiz repo id".into());
    }
    // dnf/zypper repo id'leri: harf/rakam, ., -, _, :
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')) {
        return Err("repo id'de geçersiz karakter".into());
    }
    if s.starts_with('-') || s.contains("..") {
        return Err("repo id şüpheli".into());
    }
    Ok(())
}

fn check_fs_path(p: &str) -> Result<(), String> {
    if p.is_empty() || p.len() > 4096 {
        return Err("yol uzunluğu hatalı".into());
    }
    if !p.starts_with('/') && !p.starts_with("~/") {
        return Err("yol mutlak olmalı".into());
    }
    if p.contains('\0') || p.contains('\n') || p.contains('\r') {
        return Err("yolda geçersiz karakter".into());
    }
    Ok(())
}

/// Yalnız /etc/apt/sources.list.d/ altındaki .list / .list.disabled / .sources
/// dosyalarına izin ver — /etc/apt/sources.list gibi sistem master dosyasına
/// dokunmaz.
fn check_apt_sources_path(p: &str) -> Result<(), String> {
    check_under_dir(p, "/etc/apt/sources.list.d/")?;
    let name = p.rsplit('/').next().unwrap_or("");
    if !(name.ends_with(".list")
        || name.ends_with(".list.disabled")
        || name.ends_with(".sources")
        || name.ends_with(".sources.disabled"))
    {
        return Err("yalnızca .list / .list.disabled / .sources dosyaları".into());
    }
    Ok(())
}

fn check_dnf_repos_path(p: &str) -> Result<(), String> {
    check_under_dir(p, "/etc/yum.repos.d/")?;
    let name = p.rsplit('/').next().unwrap_or("");
    if !name.ends_with(".repo") {
        return Err("yalnızca .repo dosyaları".into());
    }
    Ok(())
}

fn check_zypper_repos_path(p: &str) -> Result<(), String> {
    check_under_dir(p, "/etc/zypp/repos.d/")?;
    let name = p.rsplit('/').next().unwrap_or("");
    if !name.ends_with(".repo") {
        return Err("yalnızca .repo dosyaları".into());
    }
    Ok(())
}

fn check_under_dir(p: &str, base: &str) -> Result<(), String> {
    if !p.starts_with(base) {
        return Err(format!("yol {base} altında olmalı"));
    }
    if p.contains("..") || p.contains('\0') || p.contains('\n') {
        return Err("şüpheli yol".into());
    }
    let name = &p[base.len()..];
    if name.is_empty() || name.len() > 128 {
        return Err("dosya adı geçersiz".into());
    }
    // alt dizin yasak — sadece direkt dosya
    if name.contains('/') {
        return Err("alt dizinler kabul edilmiyor".into());
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("dosya adında geçersiz karakter".into());
    }
    Ok(())
}

fn check_ppa(s: &str) -> Result<(), String> {
    if !s.starts_with("ppa:") {
        return Err("PPA 'ppa:' ile başlamalı".into());
    }
    let rest = &s[4..];
    if rest.is_empty() || rest.len() > 128 {
        return Err("PPA adı uzunluğu geçersiz".into());
    }
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() != 2 {
        return Err("PPA formatı: ppa:sahip/ad".into());
    }
    for p in &parts {
        if p.is_empty()
            || !p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err("PPA'da geçersiz karakter".into());
        }
    }
    Ok(())
}

/// pkexec ve native paket yöneticisi exit kodlarını insan-okur mesaja
/// çevir. pkexec: 126 = kullanıcı iptal, 127 = yetki yok.
fn interpret_exit_code(prog: &str, code: i32) -> Option<String> {
    if prog == "pkexec" {
        match code {
            126 => return Some("Yetkilendirme iptal edildi (parola girilmedi).".into()),
            127 => return Some("Yetki reddedildi veya polkit ajanı yok.".into()),
            _ => {}
        }
    }
    if code == 100 {
        // dnf check-update gibi bazı komutlar "100 = updates available" döner
        return Some("Çıkış 100 — bilgilendirici durum (genelde sorun değil).".into());
    }
    None
}

/// ----- Tauri komutları -----

#[tauri::command]
pub fn start_action(app: AppHandle, req: ActionRequest, dry_run: bool) -> Result<u32, String> {
    let resolved = resolve_command(&req)?;
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let label = req
        .label
        .clone()
        .unwrap_or_else(|| format!("{} {}", req.kind, req.args.join(" ")));
    let command_pretty = format!("{} {}", resolved.program, resolved.args.join(" "));

    let now = now_secs();
    let task = Task {
        id,
        kind: req.kind.clone(),
        label,
        status: if dry_run {
            "queued".into()
        } else if resolved.needs_native_lock {
            "queued".into()
        } else {
            "running".into()
        },
        command: command_pretty.clone(),
        args: resolved.args.clone(),
        dry_run,
        needs_root: resolved.needs_root,
        needs_native_lock: resolved.needs_native_lock,
        started_at: now,
        queued_at: now,
        ended_at: None,
        exit_code: None,
        log_count: 0,
        error: None,
    };
    if let Ok(mut map) = tasks().lock() {
        map.insert(id, task.clone());
    }
    let _ = app.emit("task:update", task);

    // DRY-RUN: komut çalıştırma
    if dry_run {
        let dry_msg = format!("Çalıştırılacak komut: {command_pretty}");
        push_log(&app, id, "dry-run", &dry_msg);
        if resolved.needs_root {
            push_log(&app, id, "info", "Bu komut root yetkisi ister — gerçek modda pkexec parola sorar.");
        }
        if resolved.needs_native_lock {
            push_log(&app, id, "info", "Paralel native paket işlemleri çakışmasın diye kuyrukta beklerdi.");
        }
        update_task(id, &app, |t| {
            t.status = "succeeded".into();
            t.ended_at = Some(now_secs());
            t.exit_code = Some(0);
        });
        return Ok(id);
    }

    // GERÇEK çalıştırma — ayrı thread
    let app_clone = app.clone();
    std::thread::spawn(move || {
        run_task_blocking(app_clone, id, resolved);
    });

    Ok(id)
}

fn push_log(app: &AppHandle, task_id: u32, level: &str, text: &str) {
    let line = LogLine {
        task_id,
        level: level.into(),
        text: text.into(),
    };
    let _ = app.emit("task:log", line);
    if let Ok(mut map) = tasks().lock() {
        if let Some(t) = map.get_mut(&task_id) {
            t.log_count = t.log_count.saturating_add(1);
        }
    }
}

fn run_task_blocking(app: AppHandle, id: u32, resolved: Resolved) {
    // Native paket yöneticisi gerekiyorsa kilidi al — başka native işlemler
    // varsa burada bekler. Frontend için "queued" → "running" geçişini emit.
    let _native_guard = if resolved.needs_native_lock {
        push_log(&app, id, "info", "Native paket kilidi bekleniyor…");
        let g = NATIVE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        update_task(id, &app, |t| {
            t.status = "running".into();
            t.started_at = now_secs();
        });
        Some(g)
    } else {
        None
    };

    let mut cmd = Command::new(&resolved.program);
    cmd.args(&resolved.args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                format!("'{}' bulunamadı — kurulu mu?", resolved.program)
            } else {
                format!("başlatma hatası: {e}")
            };
            push_log(&app, id, "err", &msg);
            update_task(id, &app, |t| {
                t.status = "failed".into();
                t.ended_at = Some(now_secs());
                t.error = Some(msg);
            });
            return;
        }
    };

    // Çocuk PID'sini Task'a yaz — cancel_task buradan SIGTERM gönderir.
    let child_pid = child.id();
    update_task(id, &app, |t| { t.pid = Some(child_pid); });

    // stdout & stderr ayrı thread'lerde okunmalı — yoksa boru tampon
    // doluluğunda çocuk süreç bloklanır.
    let mut handles = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        handles.push(std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                push_log(&app, id, "out", &line);
            }
        }));
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        handles.push(std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                push_log(&app, id, "err", &line);
            }
        }));
    }

    let status = child.wait();
    for h in handles {
        let _ = h.join();
    }

    let (final_status, exit_code, error) = match status {
        Ok(s) if s.success() => ("succeeded", s.code().unwrap_or(0), None),
        Ok(s) => {
            let code = s.code().unwrap_or(-1);
            let nice = interpret_exit_code(&resolved.program, code)
                .unwrap_or_else(|| format!("exit {code}"));
            ("failed", code, Some(nice))
        }
        Err(e) => ("failed", -1, Some(e.to_string())),
    };

    if let Some(err_msg) = &error {
        push_log(&app, id, "err", err_msg);
    }

    update_task(id, &app, |t| {
        t.status = final_status.into();
        t.ended_at = Some(now_secs());
        t.exit_code = Some(exit_code);
        t.error = error;
        t.pid = None;
    });

    // Tamamlanan task'ı kalıcı geçmişe yaz.
    if let Some(t) = tasks().lock().ok().and_then(|m| m.get(&id).cloned()) {
        append_to_history(&t);
    }
}

#[tauri::command]
pub fn cancel_task(id: u32) -> Result<bool, String> {
    let pid_opt = tasks().lock().ok()
        .and_then(|m| m.get(&id).and_then(|t| t.pid));
    let Some(pid) = pid_opt else {
        return Err("Task çalışmıyor veya PID kaydı yok".into());
    };
    // SIGTERM. Çocuk thread wait() devam ediyor; child kapanınca run_task_blocking
    // status'ü "failed" olarak işaretler (exit code 143 = 128+15). UI tarafında
    // bunu "cancelled" olarak relabel eden helper ekleyebiliriz; şimdilik
    // status'e doğrudan müdahale.
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
    // 2 sn'de hala duruyorsa SIGKILL
    let pid_str = pid.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        // SIGKILL'i hâlâ ayakta olan süreçlere; öldüyse hata sessiz.
        let _ = Command::new("kill")
            .args(["-KILL", &pid_str])
            .status();
    });
    if let Ok(mut map) = tasks().lock() {
        if let Some(t) = map.get_mut(&id) {
            // running ise iptal'e geçir; aksi halde dokunma
            if t.status == "running" || t.status == "queued" {
                t.status = "cancelled".into();
                t.ended_at = Some(now_secs());
            }
        }
    }
    Ok(true)
}

// ============= KALICI HISTORY =============

fn history_dir() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    let base: PathBuf = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("santral"))
}

fn append_to_history(task: &Task) {
    let Some(dir) = history_dir() else { return; };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("history.jsonl");
    if let Ok(json) = serde_json::to_string(task) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true).append(true).open(&path)
        {
            let _ = writeln!(f, "{json}");
        }
    }
    rotate_history_if_huge(&dir);
}

/// Geçmiş dosyası 1 MB'yi aşarsa eski yarısını sil — sınırsız büyümesini önler.
fn rotate_history_if_huge(dir: &std::path::Path) {
    let path = dir.join("history.jsonl");
    let Ok(meta) = std::fs::metadata(&path) else { return; };
    if meta.len() < 1_000_000 {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&path) else { return; };
    let lines: Vec<&str> = content.lines().collect();
    let keep_from = lines.len() / 2;
    let kept = lines[keep_from..].join("\n");
    let _ = std::fs::write(&path, kept + "\n");
}

const HISTORY_LOAD_LIMIT: usize = 100;

fn load_history() -> Vec<Task> {
    let Some(dir) = history_dir() else { return vec![]; };
    let path = dir.join("history.jsonl");
    let Ok(content) = std::fs::read_to_string(&path) else { return vec![]; };
    let parsed: Vec<Task> = content.lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<Task>(l).ok())
        .take(HISTORY_LOAD_LIMIT)
        .collect();
    parsed
}

/// İlk `list_tasks` çağrısı veya init'te bellek boşsa geçmişten doldur.
fn ensure_history_loaded() {
    let mut map = match tasks().lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if !map.is_empty() {
        return;
    }
    let hist = load_history();
    let max_id = hist.iter().map(|t| t.id).max().unwrap_or(0);
    if max_id > 0 {
        // Yeni task'lar geçmişle çakışmasın — sayacı geçmişin üstüne çek.
        NEXT_ID.store(max_id + 1, Ordering::SeqCst);
    }
    for t in hist {
        map.insert(t.id, t);
    }
}

#[tauri::command]
pub fn list_tasks() -> Vec<Task> {
    ensure_history_loaded();
    tasks()
        .lock()
        .map(|m| {
            let mut v: Vec<Task> = m.values().cloned().collect();
            v.sort_by(|a, b| b.id.cmp(&a.id));
            v
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn clear_task(id: u32) -> bool {
    tasks().lock().map(|mut m| m.remove(&id).is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn clear_finished_tasks() -> u32 {
    let mut n = 0;
    if let Ok(mut m) = tasks().lock() {
        m.retain(|_, t| {
            let done = matches!(t.status.as_str(), "succeeded" | "failed" | "cancelled" | "rejected");
            if done { n += 1; }
            !done
        });
    }
    n
}
