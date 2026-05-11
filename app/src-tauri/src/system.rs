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
    }
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
    let local_time = std::process::Command::new("date")
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
    use std::process::Command;
    let mut info = ServicesInfo::default();

    // systemctl yoksa: boş döndür
    if which::which("systemctl").is_err() {
        return info;
    }

    // active / failed
    if let Ok(out) = Command::new("systemctl")
        .args(["list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain"])
        .env("LC_ALL", "C")
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
    if let Ok(out) = Command::new("systemctl")
        .args(["list-unit-files", "--type=service", "--state=enabled", "--no-legend", "--no-pager"])
        .env("LC_ALL", "C")
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
    let out = std::process::Command::new("sysctl").arg("-a").output().ok()?;
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
