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

#[derive(Debug, Clone, Serialize)]
pub struct Task {
    pub id: u32,
    pub kind: String,
    pub label: String,
    pub status: String, // "pending" | "running" | "succeeded" | "failed" | "cancelled" | "rejected"
    pub command: String,
    pub args: Vec<String>,
    pub dry_run: bool,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub log_count: u32,
    pub error: Option<String>,
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

/// ----- ALLOWLIST -----
/// Bir ActionRequest'i (program, args, needs_root) tuple'ına çevirir.
/// Bu fonksiyon TEK güven sınırıdır — burada validate edilen değerler dış
/// dünyaya geçer. Bilinmeyen `kind` → None.
fn resolve_command(req: &ActionRequest) -> Result<(String, Vec<String>, bool), String> {
    match req.kind.as_str() {
        // ----- non-root: flatpak --user -----
        "flatpak.user.install" => {
            let app_id = req.args.first().ok_or("eksik appid")?;
            check_appid(app_id)?;
            Ok((
                "flatpak".into(),
                vec![
                    "install".into(),
                    "--user".into(),
                    "--noninteractive".into(),
                    "--assumeyes".into(),
                    app_id.clone(),
                ],
                false,
            ))
        }
        "flatpak.user.remote-add" => {
            let name = req.args.first().ok_or("eksik remote adı")?;
            let url = req.args.get(1).ok_or("eksik url")?;
            check_remote_name(name)?;
            check_https_url(url)?;
            Ok((
                "flatpak".into(),
                vec![
                    "remote-add".into(),
                    "--user".into(),
                    "--if-not-exists".into(),
                    name.clone(),
                    url.clone(),
                ],
                false,
            ))
        }
        // ----- test: noop -----
        "noop.echo" => {
            let msg = req.args.first().cloned().unwrap_or_else(|| "merhaba".into());
            if msg.len() > 200 {
                return Err("echo mesajı çok uzun".into());
            }
            Ok(("echo".into(), vec![msg], false))
        }
        // ----- placeholder: root gerektirenler (Faz 7.2'de) -----
        kind if kind.starts_with("apt.") || kind.starts_with("dnf.")
            || kind.starts_with("pacman.") || kind.starts_with("zypper.")
            || kind.starts_with("systemctl.") || kind.starts_with("journalctl.")
        => {
            Err(format!("{kind}: root yetkisi gerekir — Faz 7.2'de polkit ile etkinleştirilecek"))
        }
        _ => Err(format!("bilinmeyen aksiyon: {}", req.kind)),
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

/// ----- Tauri komutları -----

#[tauri::command]
pub fn start_action(app: AppHandle, req: ActionRequest, dry_run: bool) -> Result<u32, String> {
    let (program, args, _needs_root) = resolve_command(&req)?;
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let label = req
        .label
        .clone()
        .unwrap_or_else(|| format!("{} {}", req.kind, req.args.join(" ")));
    let command_pretty = format!("{} {}", program, args.join(" "));

    let task = Task {
        id,
        kind: req.kind.clone(),
        label,
        status: if dry_run { "pending".into() } else { "running".into() },
        command: command_pretty.clone(),
        args: args.clone(),
        dry_run,
        started_at: now_secs(),
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
        run_task_blocking(app_clone, id, program, args);
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

fn run_task_blocking(app: AppHandle, id: u32, program: String, args: Vec<String>) {
    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            push_log(&app, id, "err", &format!("başlatma hatası: {e}"));
            update_task(id, &app, |t| {
                t.status = "failed".into();
                t.ended_at = Some(now_secs());
                t.error = Some(e.to_string());
            });
            return;
        }
    };

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
        Ok(s) => ("failed", s.code().unwrap_or(-1), Some(format!("exit {}", s.code().unwrap_or(-1)))),
        Err(e) => ("failed", -1, Some(e.to_string())),
    };
    update_task(id, &app, |t| {
        t.status = final_status.into();
        t.ended_at = Some(now_secs());
        t.exit_code = Some(exit_code);
        t.error = error;
    });
}

#[tauri::command]
pub fn list_tasks() -> Vec<Task> {
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
