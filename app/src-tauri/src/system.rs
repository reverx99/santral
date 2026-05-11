//! Sistem bilgisi toplayıcısı: cpu, ram, disk, kernel, uptime, hostname.
//! sysinfo crate'i ağırlıklı; bazı şeyleri /proc'tan okur.

use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Serialize, Clone, Debug)]
pub struct SystemInfo {
    pub hostname: String,
    pub kernel: String,
    pub os_name: String,
    pub uptime_secs: u64,
    pub boot_time: u64,
    pub user: String,
    pub shell: String,
    pub desktop: String,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub swap: SwapInfo,
    pub disks: Vec<DiskInfo>,
    pub load_avg: LoadAvg,
    pub locale: LocaleInfo,
    pub services: ServicesInfo,
    pub kernel_params_count: Option<u64>,
    pub session_type: String,
    pub boot_analyze: Option<BootAnalyze>,
    pub top_cpu: Vec<TopProcess>,
    pub top_mem: Vec<TopProcess>,
}

#[derive(Serialize, Clone, Debug)]
pub struct BootAnalyze {
    pub total_ms:      u64,
    pub firmware_ms:   Option<u64>,
    pub loader_ms:     Option<u64>,
    pub kernel_ms:     Option<u64>,
    pub initrd_ms:     Option<u64>,
    pub userspace_ms:  Option<u64>,
    pub target:        Option<String>,
    pub target_ms:     Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct TopProcess {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct LocaleInfo {
    pub lang: String,
    pub timezone: String,
    pub local_time: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ServicesInfo {
    pub active: u64,
    pub inactive: u64,
    pub failed: u64,
    pub enabled: u64,
    pub failed_units: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CpuInfo {
    pub model: String,
    pub cores_physical: usize,
    pub cores_logical: usize,
    pub frequency_mhz: u64,
    pub usage_percent: f32,
    pub arch: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct SwapInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f32,
    pub removable: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LoadAvg {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

pub fn collect() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();
    // refresh_cpu twice with a tiny delay yields a usable usage_percent reading
    sys.refresh_cpu_all();
    std::thread::sleep(std::time::Duration::from_millis(120));
    sys.refresh_cpu_all();

    let cpus = sys.cpus();
    let cpu_usage = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    };
    let cpu_model = cpus
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "bilinmiyor".to_string());
    let frequency = cpus.first().map(|c| c.frequency()).unwrap_or(0);

    let mem_total = sys.total_memory();
    let mem_used = sys.used_memory();
    let mem_avail = sys.available_memory();
    let swap_total = sys.total_swap();
    let swap_used = sys.used_swap();

    let disks = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| {
            let total = d.total_space();
            let avail = d.available_space();
            let used = total.saturating_sub(avail);
            DiskInfo {
                name: d.name().to_string_lossy().to_string(),
                mount_point: d.mount_point().to_string_lossy().to_string(),
                fs_type: d.file_system().to_string_lossy().to_string(),
                total_bytes: total,
                available_bytes: avail,
                used_bytes: used,
                usage_percent: pct(used, total),
                removable: d.is_removable(),
            }
        })
        .filter(|d| {
            // pseudo & system mounts: gizle
            !d.mount_point.starts_with("/proc")
                && !d.mount_point.starts_with("/sys")
                && !d.mount_point.starts_with("/dev")
                && !d.mount_point.starts_with("/run")
                && !d.mount_point.starts_with("/snap/")
                && d.total_bytes > 0
        })
        .collect();

    let la = System::load_average();

    SystemInfo {
        hostname: System::host_name().unwrap_or_default(),
        kernel: System::kernel_version().unwrap_or_default(),
        os_name: System::long_os_version().unwrap_or_default(),
        uptime_secs: System::uptime(),
        boot_time: System::boot_time(),
        user: std::env::var("USER").unwrap_or_default(),
        shell: shell_name(),
        desktop: desktop_env(),
        cpu: CpuInfo {
            model: cpu_model,
            cores_physical: sys.physical_core_count().unwrap_or(0),
            cores_logical: cpus.len(),
            frequency_mhz: frequency,
            usage_percent: cpu_usage,
            arch: std::env::consts::ARCH.to_string(),
        },
        memory: MemoryInfo {
            total_bytes: mem_total,
            used_bytes: mem_used,
            available_bytes: mem_avail,
            usage_percent: pct(mem_used, mem_total),
        },
        swap: SwapInfo {
            total_bytes: swap_total,
            used_bytes: swap_used,
            usage_percent: pct(swap_used, swap_total),
        },
        disks,
        load_avg: LoadAvg { one: la.one, five: la.five, fifteen: la.fifteen },
        locale: collect_locale(),
        services: collect_services(),
        kernel_params_count: count_kernel_params(),
        session_type: std::env::var("XDG_SESSION_TYPE").unwrap_or_default(),
        boot_analyze: collect_boot_analyze(),
        top_cpu: collect_top_processes(&sys, true),
        top_mem: collect_top_processes(&sys, false),
    }
}

fn collect_top_processes(sys: &System, by_cpu: bool) -> Vec<TopProcess> {
    let mut all: Vec<TopProcess> = sys
        .processes()
        .iter()
        .map(|(pid, p)| TopProcess {
            pid: pid.as_u32(),
            name: p.name().to_string_lossy().to_string(),
            cpu_percent: p.cpu_usage(),
            memory_bytes: p.memory(),
        })
        // çekirdek/idle thread'leri yakalama:
        .filter(|t| t.memory_bytes > 0 || t.cpu_percent > 0.0)
        .collect();

    if by_cpu {
        all.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
    } else {
        all.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
    }
    all.into_iter().take(5).collect()
}

/// `systemd-analyze` çıktısını parse eder:
///   "Startup finished in 4.523s (firmware) + 1.234s (loader) + 1.567s (kernel) + 3.890s (initrd) + 5.123s (userspace) = 16.337s
///    graphical.target reached after 5.014s in userspace."
fn collect_boot_analyze() -> Option<BootAnalyze> {
    if which::which("systemd-analyze").is_err() {
        return None;
    }
    let out = crate::util::timed("systemd-analyze", 10).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();

    let mut ba = BootAnalyze {
        total_ms: 0,
        firmware_ms: None, loader_ms: None, kernel_ms: None,
        initrd_ms: None, userspace_ms: None,
        target: None, target_ms: None,
    };

    for line in text.lines() {
        let trim = line.trim();
        if trim.starts_with("Startup finished in") {
            // pre = "(firmware)", "(loader)", "(kernel)", "(initrd)", "(userspace)"
            // and "= total"
            for piece in trim.split(['+', '=']) {
                let p = piece.trim();
                if let Some(t) = parse_section(p, "firmware") {
                    ba.firmware_ms = Some(t);
                } else if let Some(t) = parse_section(p, "loader") {
                    ba.loader_ms = Some(t);
                } else if let Some(t) = parse_section(p, "kernel") {
                    ba.kernel_ms = Some(t);
                } else if let Some(t) = parse_section(p, "initrd") {
                    ba.initrd_ms = Some(t);
                } else if let Some(t) = parse_section(p, "userspace") {
                    ba.userspace_ms = Some(t);
                } else {
                    // bu son "= 16.337s" parçası: parantezi yok, sadece saniye
                    if !p.contains('(') {
                        if let Some(ms) = parse_time(p) {
                            ba.total_ms = ms;
                        }
                    }
                }
            }
        } else if trim.contains(".target reached after") {
            // "graphical.target reached after 5.014s in userspace"
            if let Some(rest) = trim.split(".target").next() {
                ba.target = Some(rest.trim().to_string());
            }
            if let Some(after) = trim.split("reached after").nth(1) {
                let chunk = after.split_whitespace().next().unwrap_or("");
                ba.target_ms = parse_time(chunk);
            }
        }
    }

    // Hiçbir alan dolmadıysa veri yok
    if ba.total_ms == 0
        && ba.firmware_ms.is_none()
        && ba.loader_ms.is_none()
        && ba.kernel_ms.is_none()
        && ba.userspace_ms.is_none()
    {
        return None;
    }
    Some(ba)
}

fn parse_section(piece: &str, label: &str) -> Option<u64> {
    // "4.523s (firmware)" şeklinde — etiket eşleşmesi
    if !piece.contains(label) {
        return None;
    }
    let num = piece.split('(').next()?.trim();
    parse_time(num)
}

/// "4.523s", "16.337s", "342ms", "1min 4.523s" → milisaniye
fn parse_time(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.is_empty() { return None; }

    // "1min 4.523s" gibi karma birimler
    if s.contains("min") {
        let mut total = 0u64;
        for part in s.split_whitespace() {
            if let Some(stripped) = part.strip_suffix("min") {
                total += stripped.parse::<f64>().ok().map(|m| (m * 60_000.0) as u64).unwrap_or(0);
            } else if let Some(stripped) = part.strip_suffix("ms") {
                total += stripped.parse::<f64>().unwrap_or(0.0) as u64;
            } else if let Some(stripped) = part.strip_suffix('s') {
                total += (stripped.parse::<f64>().unwrap_or(0.0) * 1000.0) as u64;
            }
        }
        return Some(total);
    }

    if let Some(stripped) = s.strip_suffix("ms") {
        return stripped.parse::<f64>().ok().map(|v| v as u64);
    }
    if let Some(stripped) = s.strip_suffix('s') {
        return stripped.parse::<f64>().ok().map(|v| (v * 1000.0) as u64);
    }
    None
}

fn collect_locale() -> LocaleInfo {
    let lang = std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default();
    let timezone = std::fs::read_to_string("/etc/timezone")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| {
            // Çoğu modern dağıtım /etc/timezone'u tutmaz; /etc/localtime sembolik link'i okur
            std::fs::read_link("/etc/localtime")
                .ok()
                .and_then(|p| {
                    let s = p.to_string_lossy().to_string();
                    // .../zoneinfo/Europe/Istanbul → Europe/Istanbul
                    s.split("zoneinfo/").nth(1).map(|x| x.to_string())
                })
                .unwrap_or_default()
        });
    let local_time = crate::util::timed("date", 3)
        .arg("+%Y-%m-%d %H:%M:%S %Z")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();
    LocaleInfo { lang, timezone, local_time }
}

fn collect_services() -> ServicesInfo {
    use crate::util::timed;
    let mut info = ServicesInfo::default();

    // systemctl yoksa: boş döndür
    if which::which("systemctl").is_err() {
        return info;
    }

    // active / failed
    if let Ok(out) = timed("systemctl", 10)
        .args(["list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain"])
        .output()
    {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                // unit  load  active  sub  description
                if parts.len() < 4 { continue; }
                let active = parts[2];
                match active {
                    "active"    => info.active += 1,
                    "failed"    => {
                        info.failed += 1;
                        if info.failed_units.len() < 8 {
                            info.failed_units.push(parts[0].to_string());
                        }
                    },
                    _           => info.inactive += 1,
                }
            }
        }
    }

    // enabled
    if let Ok(out) = timed("systemctl", 10)
        .args(["list-unit-files", "--type=service", "--state=enabled", "--no-legend", "--no-pager"])
        .output()
    {
        if out.status.success() {
            info.enabled = String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count() as u64;
        }
    }

    info
}

fn count_kernel_params() -> Option<u64> {
    let out = crate::util::timed("sysctl", 5).arg("-a").output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| !l.trim().is_empty() && l.contains('='))
            .count() as u64,
    )
}

fn pct(num: u64, denom: u64) -> f32 {
    if denom == 0 {
        return 0.0;
    }
    (num as f64 * 100.0 / denom as f64) as f32
}

fn shell_name() -> String {
    let path = std::env::var("SHELL").unwrap_or_default();
    path.rsplit('/').next().unwrap_or(&path).to_string()
}

fn desktop_env() -> String {
    for var in ["XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "GDMSESSION"] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    String::new()
}
