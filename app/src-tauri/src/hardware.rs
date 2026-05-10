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
    }
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
