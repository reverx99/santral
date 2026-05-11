//! Donanım tespiti: lspci/lsusb/bluetoothctl gibi komutlardan veri toplar.
//! Hepsi salt-okunur, yetki gerektirmez. Komutlar yoksa kibarca boş döner.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct HardwareInfo {
    pub gpus: Vec<DeviceLine>,
    pub audio: Vec<DeviceLine>,
    pub network: Vec<NetworkInterface>,
    pub bluetooth: Bluetooth,
    pub usb: Vec<DeviceLine>,
    pub cpu_extra: CpuExtra,
    pub battery: Option<BatteryInfo>,
    pub thermal: ThermalInfo,
    pub secure_boot: SecureBootInfo,
    pub modules: ModulesInfo,
    pub uefi: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatteryInfo {
    pub name: String,
    pub vendor: Option<String>,
    pub model: Option<String>,
    pub capacity_percent: Option<u32>,        // şu anki şarj %
    pub status: String,                       // Charging / Discharging / Full / Unknown
    pub design_capacity: Option<u64>,         // mWh
    pub current_capacity: Option<u64>,        // mWh
    pub health_percent: Option<u32>,          // current/design
    pub cycle_count: Option<u32>,
    pub ac_online: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ThermalInfo {
    pub sensors: Vec<ThermalSensor>,
    pub fans: Vec<FanSensor>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ThermalSensor {
    pub label: String,
    pub temperature_c: f32,
    pub kind: String, // cpu / gpu / acpi / other
}

#[derive(Serialize, Clone, Debug)]
pub struct FanSensor {
    pub label: String,
    pub rpm: u32,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SecureBootInfo {
    pub supported: bool,    // UEFI mi (efivars var mı)
    pub enabled: Option<bool>,
    pub source: String,     // "mokutil" | "efivars" | ""
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ModulesInfo {
    pub loaded: u64,
    pub examples: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DeviceLine {
    pub vendor: String,
    pub product: String,
    pub raw: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct NetworkInterface {
    pub name: String,
    pub mac: String,
    pub state: String,
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    pub kind: String, // ethernet / wifi / loopback / virtual
}

#[derive(Serialize, Clone, Debug)]
pub struct Bluetooth {
    pub adapter_present: bool,
    pub adapter_name: Option<String>,
    pub powered: bool,
    pub service_active: bool,
    pub raw_status: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct CpuExtra {
    pub virtualization: Option<String>,
    pub flags_excerpt: Vec<String>,
    pub microcode: Option<String>,
}

pub fn collect() -> HardwareInfo {
    HardwareInfo {
        gpus: collect_pci_class("VGA compatible controller")
            .into_iter()
            .chain(collect_pci_class("3D controller"))
            .chain(collect_pci_class("Display controller"))
            .collect(),
        audio: collect_pci_class("Audio device"),
        network: collect_network(),
        bluetooth: collect_bluetooth(),
        usb: collect_usb(),
        cpu_extra: collect_cpu_extra(),
        battery: collect_battery(),
        thermal: collect_thermal(),
        secure_boot: collect_secure_boot(),
        modules: collect_modules(),
        uefi: std::path::Path::new("/sys/firmware/efi").exists(),
    }
}

fn collect_battery() -> Option<BatteryInfo> {
    let entries = std::fs::read_dir("/sys/class/power_supply").ok()?;
    let mut ac_online = false;
    let mut bat_path: Option<std::path::PathBuf> = None;

    for e in entries.flatten() {
        let p = e.path();
        let kind = std::fs::read_to_string(p.join("type"))
            .unwrap_or_default()
            .trim()
            .to_string();
        match kind.as_str() {
            "Battery" => {
                if bat_path.is_none() {
                    bat_path = Some(p);
                }
            }
            "Mains" | "USB" | "AC" => {
                if let Ok(on) = std::fs::read_to_string(p.join("online")) {
                    if on.trim() == "1" {
                        ac_online = true;
                    }
                }
            }
            _ => {}
        }
    }

    let bat_path = bat_path?;
    let read = |f: &str| std::fs::read_to_string(bat_path.join(f)).ok().map(|s| s.trim().to_string());

    let capacity_percent: Option<u32> = read("capacity").and_then(|s| s.parse().ok());
    let status = read("status").unwrap_or_else(|| "Unknown".to_string());

    // BIRIM: energy_* µWh, charge_* µAh. ASLA karıştırma — sağlık yüzdesi
    // sadece aynı pair'den hesaplanmalı. UI sadece mWh (energy) görüntüler;
    // charge varsa health hesabı yapılır ama capacity_* alanları None bırakılır.
    let energy_d: Option<u64> = read("energy_full_design").and_then(|s| s.parse().ok());
    let energy_c: Option<u64> = read("energy_full").and_then(|s| s.parse().ok());
    let charge_d: Option<u64> = read("charge_full_design").and_then(|s| s.parse().ok());
    let charge_c: Option<u64> = read("charge_full").and_then(|s| s.parse().ok());

    let health_percent = match (energy_d, energy_c) {
        (Some(d), Some(c)) if d > 0 => Some(((c as f64) / (d as f64) * 100.0).round() as u32),
        _ => match (charge_d, charge_c) {
            (Some(d), Some(c)) if d > 0 => Some(((c as f64) / (d as f64) * 100.0).round() as u32),
            _ => None,
        },
    };

    // sadece energy_* alanlarını dışarı veriyoruz (µWh — frontend /1000 ile mWh, /1000000 ile Wh çevirebilir).
    // Bizdeki yapı zaten mWh ölçüsünde gösteriyor: değerleri /1000 yaparak mWh'ye getiriyoruz.
    let design_capacity = energy_d.map(|v| v / 1000);
    let current_capacity = energy_c.map(|v| v / 1000);

    let cycle_count: Option<u32> = read("cycle_count").and_then(|s| s.parse().ok());
    let vendor = read("manufacturer");
    let model = read("model_name");
    let name = bat_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    Some(BatteryInfo {
        name, vendor, model,
        capacity_percent, status,
        design_capacity, current_capacity,
        health_percent, cycle_count,
        ac_online,
    })
}

fn collect_thermal() -> ThermalInfo {
    let mut out = ThermalInfo::default();
    // /sys/class/thermal/thermal_zone*: type + temp (milli-Celsius)
    if let Ok(entries) = std::fs::read_dir("/sys/class/thermal") {
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with("thermal_zone") {
                continue;
            }
            let kind = std::fs::read_to_string(p.join("type")).unwrap_or_default().trim().to_string();
            let temp_raw = std::fs::read_to_string(p.join("temp")).ok()
                .and_then(|s| s.trim().parse::<i64>().ok());
            if let Some(milli) = temp_raw {
                let c = milli as f32 / 1000.0;
                if c.is_finite() && c > -50.0 && c < 200.0 {
                    let categorized = categorize_thermal(&kind);
                    out.sensors.push(ThermalSensor {
                        label: kind,
                        temperature_c: c,
                        kind: categorized,
                    });
                }
            }
        }
    }

    // /sys/class/hwmon/hwmon*/fanN_input — RPM
    if let Ok(entries) = std::fs::read_dir("/sys/class/hwmon") {
        for e in entries.flatten() {
            let p = e.path();
            let hwname = std::fs::read_to_string(p.join("name")).unwrap_or_default().trim().to_string();
            if let Ok(files) = std::fs::read_dir(&p) {
                for f in files.flatten() {
                    let fname = f.file_name().to_string_lossy().to_string();
                    if !(fname.starts_with("fan") && fname.ends_with("_input")) {
                        continue;
                    }
                    if let Ok(text) = std::fs::read_to_string(f.path()) {
                        if let Ok(rpm) = text.trim().parse::<u32>() {
                            if rpm > 0 {
                                let label = if hwname.is_empty() { fname.clone() } else { format!("{hwname} · {fname}") };
                                out.fans.push(FanSensor { label, rpm });
                            }
                        }
                    }
                }
            }
        }
    }

    out
}

fn categorize_thermal(label: &str) -> String {
    let l = label.to_ascii_lowercase();
    if l.contains("x86_pkg") || l.contains("coretemp") || l.contains("cpu") {
        "cpu".to_string()
    } else if l.contains("gpu") || l.contains("amdgpu") || l.contains("nv") {
        "gpu".to_string()
    } else if l.contains("acpi") {
        "acpi".to_string()
    } else if l.contains("nvme") {
        "nvme".to_string()
    } else {
        "other".to_string()
    }
}

fn collect_secure_boot() -> SecureBootInfo {
    let mut out = SecureBootInfo::default();
    out.supported = std::path::Path::new("/sys/firmware/efi").exists();
    if !out.supported {
        return out;
    }

    // önce mokutil dene
    if let Ok(o) = std::process::Command::new("mokutil").arg("--sb-state").output() {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            if text.contains("SecureBoot enabled") {
                out.enabled = Some(true);
                out.source = "mokutil".into();
                return out;
            } else if text.contains("SecureBoot disabled") {
                out.enabled = Some(false);
                out.source = "mokutil".into();
                return out;
            }
        }
    }

    // efivars üzerinden son byte'a bak
    let efivars_dir = "/sys/firmware/efi/efivars";
    if let Ok(entries) = std::fs::read_dir(efivars_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("SecureBoot-") {
                if let Ok(bytes) = std::fs::read(e.path()) {
                    // 4-byte attribute header, ardından 1 byte değer
                    if bytes.len() >= 5 {
                        out.enabled = Some(bytes[4] == 1);
                        out.source = "efivars".into();
                    }
                }
                break;
            }
        }
    }
    out
}

fn collect_modules() -> ModulesInfo {
    let mut out = ModulesInfo::default();
    let proc_modules = std::fs::read_to_string("/proc/modules").unwrap_or_default();
    let mut names: Vec<String> = proc_modules
        .lines()
        .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
        .collect();
    out.loaded = names.len() as u64;
    names.sort();
    out.examples = names.into_iter().take(8).collect();
    out
}

/// `lspci -mm | grep -i CLASS` üzerinden PCI cihazlarını okur. Komut yoksa boş.
fn collect_pci_class(class: &str) -> Vec<DeviceLine> {
    let Ok(output) = Command::new("lspci").args(["-mm", "-nn"]).output() else {
        return vec![];
    };
    if !output.status.success() {
        return vec![];
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    text.lines()
        .filter(|l| l.to_lowercase().contains(&class.to_lowercase()))
        .map(parse_lspci_line)
        .collect()
}

fn parse_lspci_line(line: &str) -> DeviceLine {
    // örnek: "01:00.0 "VGA compatible controller [0300]" "NVIDIA Corp. [10de]" "GA106 [GeForce RTX 3060] [2487]" -ra1 "ASUS [1043]" "GA106 [104b]""
    let parts: Vec<&str> = line.splitn(2, ' ').collect();
    let rest = parts.get(1).unwrap_or(&"").to_string();
    let fields: Vec<String> = split_quoted(&rest);
    let vendor = fields.get(1).cloned().unwrap_or_default();
    let product = fields.get(2).cloned().unwrap_or_default();
    DeviceLine {
        vendor: clean_brackets(&vendor),
        product: clean_brackets(&product),
        raw: line.trim().to_string(),
    }
}

fn split_quoted(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    for ch in input.chars() {
        match ch {
            '"' => {
                if in_quote {
                    out.push(std::mem::take(&mut cur));
                    in_quote = false;
                } else {
                    in_quote = true;
                }
            }
            _ if in_quote => cur.push(ch),
            _ => {}
        }
    }
    out
}

fn clean_brackets(s: &str) -> String {
    // "NVIDIA Corp. [10de]" → "NVIDIA Corp."
    let mut out = String::with_capacity(s.len());
    let mut depth = 0i32;
    for ch in s.chars() {
        if ch == '[' {
            depth += 1;
            continue;
        }
        if ch == ']' {
            depth = (depth - 1).max(0);
            continue;
        }
        if depth == 0 {
            out.push(ch);
        }
    }
    out.trim().to_string()
}

fn collect_network() -> Vec<NetworkInterface> {
    // /sys/class/net altındaki her dizin bir arayüzdür.
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir("/sys/class/net") else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let mac = std::fs::read_to_string(entry.path().join("address"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let state = std::fs::read_to_string(entry.path().join("operstate"))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        let kind = classify_iface(&name, &entry.path());
        out.push(NetworkInterface {
            name,
            mac,
            state,
            ipv4: vec![],
            ipv6: vec![],
            kind,
        });
    }
    // ip adreslerini `ip -o addr` ile doldur
    if let Ok(output) = Command::new("ip").args(["-o", "addr"]).output() {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 {
                    continue;
                }
                let iface = parts[1].trim_end_matches(':');
                let family = parts[2];
                let addr = parts[3].split('/').next().unwrap_or("").to_string();
                if let Some(target) = out.iter_mut().find(|i| i.name == iface) {
                    match family {
                        "inet" => target.ipv4.push(addr),
                        "inet6" => target.ipv6.push(addr),
                        _ => {}
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn classify_iface(name: &str, path: &std::path::Path) -> String {
    if name == "lo" {
        return "loopback".to_string();
    }
    if path.join("wireless").exists() || name.starts_with("wl") || name.starts_with("wlan") {
        return "wifi".to_string();
    }
    if name.starts_with("docker")
        || name.starts_with("br-")
        || name.starts_with("veth")
        || name.starts_with("virbr")
        || name.starts_with("vmnet")
        || name.starts_with("tun")
        || name.starts_with("tap")
    {
        return "virtual".to_string();
    }
    if name.starts_with("en") || name.starts_with("eth") {
        return "ethernet".to_string();
    }
    "other".to_string()
}

fn collect_bluetooth() -> Bluetooth {
    let mut bt = Bluetooth {
        adapter_present: false,
        adapter_name: None,
        powered: false,
        service_active: false,
        raw_status: String::new(),
    };

    // /sys/class/bluetooth varlığı = adapter present
    if let Ok(entries) = std::fs::read_dir("/sys/class/bluetooth") {
        for e in entries.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("hci") {
                bt.adapter_present = true;
                bt.adapter_name = Some(n);
                break;
            }
        }
    }

    // bluetoothctl show (yetki gerektirmez)
    if let Ok(out) = Command::new("bluetoothctl").arg("show").output() {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            for line in text.lines() {
                let l = line.trim();
                if l.starts_with("Powered:") {
                    bt.powered = l.ends_with("yes");
                }
                if l.starts_with("Name:") && bt.adapter_name.is_none() {
                    bt.adapter_name = l.split_once(':').map(|(_, v)| v.trim().to_string());
                }
            }
            bt.raw_status = text;
        }
    }

    // systemctl is-active bluetooth
    if let Ok(out) = Command::new("systemctl").args(["is-active", "bluetooth"]).output() {
        bt.service_active = out.status.success()
            && String::from_utf8_lossy(&out.stdout).trim() == "active";
    }

    bt
}

fn collect_usb() -> Vec<DeviceLine> {
    let Ok(output) = Command::new("lsusb").output() else {
        return vec![];
    };
    if !output.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            // "Bus 002 Device 003: ID 1d6b:0003 Linux Foundation 3.0 root hub"
            let after_id = l.splitn(2, "ID ").nth(1).unwrap_or("");
            let parts: Vec<&str> = after_id.splitn(2, ' ').collect();
            let rest = parts.get(1).unwrap_or(&"").to_string();
            DeviceLine {
                vendor: rest.clone(),
                product: String::new(),
                raw: l.to_string(),
            }
        })
        .collect()
}

fn collect_cpu_extra() -> CpuExtra {
    let cpuinfo = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let mut microcode = None;
    let mut flags_excerpt = vec![];
    for line in cpuinfo.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim();
            let v = v.trim().to_string();
            if k == "microcode" && microcode.is_none() {
                microcode = Some(v.clone());
            }
            if k == "flags" && flags_excerpt.is_empty() {
                let interesting = ["vmx", "svm", "aes", "avx", "avx2", "avx512f", "sha_ni"];
                flags_excerpt = v
                    .split_whitespace()
                    .filter(|f| interesting.iter().any(|i| i.eq_ignore_ascii_case(f)))
                    .map(String::from)
                    .collect();
            }
        }
    }
    let virtualization = detect_virtualization();
    CpuExtra { virtualization, flags_excerpt, microcode }
}

fn detect_virtualization() -> Option<String> {
    if let Ok(out) = Command::new("systemd-detect-virt").output() {
        if out.status.success() {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !v.is_empty() && v != "none" {
                return Some(v);
            }
            return None;
        }
    }
    None
}
