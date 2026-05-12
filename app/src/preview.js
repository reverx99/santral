// preview entry — Tauri olmadan tarayıcıda mock veriyle render etmek için.
// Sadece UI'yi göstermeye yarar; sürüme hiçbir etkisi yoktur.

import { renderSistem }       from "./pages/sistem.js";
import { renderDonanim }      from "./pages/donanim.js";
import { renderUygulamalar }  from "./pages/uygulamalar.js";
import { renderTarama }       from "./pages/tarama.js";
import { renderPaketler }     from "./pages/paketler.js";
import { renderOptimizasyon } from "./pages/optimizasyon.js";
import { renderRepolar }      from "./pages/repolar.js";
import { renderSuruculer }    from "./pages/suruculer.js";
import { renderAyarlar }      from "./pages/ayarlar.js";
import { renderHakkinda }     from "./pages/hakkinda.js";
import { settings }           from "./settings.js";
import { toast }              from "./toast.js";
import { palette }            from "./palette.js";
import { tasks }              from "./tasks.js";
import { mountTaskDrawer }    from "./task-drawer.js";

// settings yan etki: theme/font/zoom uygulansın
settings.apply?.();

let CATALOG_CACHE = null;
async function loadCatalog() {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const r = await fetch("/data/apps.json");
  const raw = await r.json();
  CATALOG_CACHE = {
    version: raw.version,
    updated: raw.updated,
    categories: raw.categories,
    apps: raw.apps,
    detected_sources: ["apt", "flatpak"],
    preferred_source: "apt",
  };
  return CATALOG_CACHE;
}

let SCAN_CACHE = null;
async function loadScanners() {
  if (SCAN_CACHE) return SCAN_CACHE;
  const r = await fetch("/data/scanners.json");
  const raw = await r.json();
  // mock: rastgele kurulu durumlar
  const installedSet = new Set(["chkrootkit", "lynis", "rpm-verify"]);
  SCAN_CACHE = {
    version: raw.version,
    updated: raw.updated,
    categories: raw.categories,
    scanners: raw.scanners.map((s) => ({
      ...s,
      installed: installedSet.has(s.id),
      installable: Object.keys(s.sources || {}).length > 0,
    })),
    detected_sources: ["apt", "flatpak"],
    preferred_source: "apt",
  };
  return SCAN_CACHE;
}

// preview için sahte task state (gerçek Tauri event'i yok)
const PREVIEW_TASKS = new Map();
let _previewTaskId = 1;

async function fakeStartAction({ req, dryRun }) {
  const id = _previewTaskId++;
  const isRoot = !req.kind.startsWith("flatpak.user") && req.kind !== "noop.echo";
  const program = isRoot ? "pkexec" : (req.kind.startsWith("flatpak") ? "flatpak" : "echo");
  const pretty = `${program} ${(req.args || []).join(" ")}`;
  const task = {
    id, kind: req.kind, label: req.label || req.kind,
    status: dryRun ? "succeeded" : "running",
    command: pretty,
    args: req.args || [], dry_run: !!dryRun,
    needs_root: isRoot, needs_native_lock: isRoot,
    started_at: Math.floor(Date.now() / 1000),
    queued_at: Math.floor(Date.now() / 1000),
    ended_at: dryRun ? Math.floor(Date.now() / 1000) : null,
    exit_code: dryRun ? 0 : null,
    log_count: 0, error: null,
  };
  PREVIEW_TASKS.set(id, task);
  tasks.onTaskUpdate(task);
  if (dryRun) {
    tasks.onTaskLog({ task_id: id, level: "dry-run", text: `Çalıştırılacak komut: ${pretty}` });
    if (isRoot) tasks.onTaskLog({ task_id: id, level: "info", text: "Bu komut root yetkisi ister — gerçek modda pkexec parola sorar." });
    task.log_count = isRoot ? 2 : 1;
    return id;
  }
  // gerçek mod simülasyonu — kind'a göre uygun fake log'lar
  const fakeLines = fakeLogsFor(req.kind, req.args || []);
  let i = 0;
  const tick = () => {
    if (i < fakeLines.length) {
      const ln = fakeLines[i++];
      tasks.onTaskLog({ task_id: id, level: ln.level || "out", text: ln.text });
      task.log_count++;
      setTimeout(tick, 280);
    } else {
      task.status = "succeeded";
      task.ended_at = Math.floor(Date.now() / 1000);
      task.exit_code = 0;
      tasks.onTaskUpdate(task);
    }
  };
  setTimeout(tick, 220);
  return id;
}

function fakeLogsFor(kind, args) {
  const pkg = args[0] || "paket";
  if (kind === "flatpak.user.install") {
    return [
      { text: "Looking for matches…" },
      { text: `Required runtime for ${pkg}: org.freedesktop.Platform/x86_64/23.08` },
      { text: "Receiving objects: 100% (12/12)" },
      { text: "Installation complete." },
    ];
  }
  if (kind === "flatpak.user.remote-add") {
    return [{ text: `Remote eklendi: ${args[0]} → ${args[1]}` }];
  }
  if (kind === "flatpak.user.uninstall-unused") {
    return [
      { text: "Looking for unused runtimes…" },
      { text: "Uninstalling org.freedesktop.Platform.GL.default" },
      { text: "Uninstall complete." },
    ];
  }
  if (kind.endsWith(".install")) {
    const pm = kind.split(".")[0].toUpperCase();
    return [
      { text: `Reading package lists…` },
      { text: `Building dependency tree…` },
      { text: `The following NEW packages will be installed: ${pkg}` },
      { text: `Get:1 ${pkg} 117.0 [55.4 MB]` },
      { text: `Fetched 55.4 MB in 4s (12.8 MB/s)` },
      { text: `Selecting previously unselected package ${pkg}.` },
      { text: `Setting up ${pkg} (117.0)…` },
      { text: `[${pm}] ✓ kurulum tamamlandı` },
    ];
  }
  if (kind.endsWith(".autoremove")) {
    return [
      { text: `Reading package lists…` },
      { text: `12 paket kaldırılacak: libfoo libbar libbaz …` },
      { text: `Freed 142 MB.` },
    ];
  }
  if (kind.endsWith(".clean")) {
    return [
      { text: `Clearing package cache…` },
      { text: `Removed 642 MB of cached packages.` },
    ];
  }
  if (kind === "journalctl.vacuum-time") {
    return [
      { text: `Deleted archived journal /var/log/journal/.../system@…journal` },
      { text: `Vacuuming done, freed 312.0M of archived journals…` },
    ];
  }
  return [{ text: `Simüle edildi: ${kind} ${args.join(" ")}` }];
}

const MOCK = {
  optimization_scan: () => ({
    native_kind: "apt",
    total_bytes: 1.8 * 1024 ** 3,
    categories: [
      {
        id: "native-cache", label: "APT paket önbelleği",
        description: "İndirilmiş paket arşivleri (/var/cache/apt/archives). Yeniden indirilebilirler, silmek güvenli.",
        size_bytes: 642 * 1024 ** 2, item_count: null,
        command: "apt-get clean", safety: "safe", status: "found",
        icon: "▰", color: "#ff0099",
      },
      {
        id: "journal", label: "Sistem günlükleri",
        description: "systemd-journald'in tuttuğu kayıt geçmişi. 7 günden eskisini silmek güvenli.",
        size_bytes: 384 * 1024 ** 2, item_count: null,
        command: "journalctl --vacuum-time=7d", safety: "safe", status: "found",
        icon: "▤", color: "#00f0ff",
      },
      {
        id: "user-cache", label: "Kullanıcı önbelleği",
        description: "~/.cache altındaki uygulama önbellekleri (tarayıcılar, miniatür önbellekleri, vb.). Silmek genelde güvenli ama uygulama açıkken kapatmak iyi olur.",
        size_bytes: 712 * 1024 ** 2, item_count: null,
        command: "rm -rf ~/.cache/*", safety: "review", status: "found",
        icon: "✱", color: "#b400ff",
      },
      {
        id: "thumbnails", label: "Önizleme küçük resimleri",
        description: "Dosya yöneticisinin oluşturduğu thumbnail önbelleği. Sadece görsel; silmek güvenli, gerektikçe yeniden üretilir.",
        size_bytes: 64 * 1024 ** 2, item_count: null,
        command: "rm -rf ~/.cache/thumbnails", safety: "safe", status: "found",
        icon: "▥", color: "#ffd400",
      },
      {
        id: "tmp", label: "Geçici dosyalar",
        description: "/tmp altındaki geçici dosyalar. Çoğu uygulama her açılışta kendi tmp'sini yönetir; manuel silinmemeli.",
        size_bytes: 28 * 1024 ** 2, item_count: null,
        command: "# /tmp'i el ile temizleme önerilmez — sistem yeniden başladığında zaten temizlenir.",
        safety: "manual", status: "found", icon: "▭", color: "#5a5a6a",
      },
      {
        id: "autoremove", label: "Yetim paketler",
        description: "Bağımlılık olarak kurulup artık hiçbir paketin gerek duymadığı paketler. Kaldırmak güvenlidir.",
        size_bytes: 0, item_count: 14,
        command: "apt-get autoremove --purge -y", safety: "review", status: "found",
        icon: "✕", color: "#ff4477",
      },
      {
        id: "flatpak-unused", label: "Kullanılmayan Flatpak runtime'ları",
        description: "Hiçbir Flatpak uygulaması tarafından kullanılmayan ortak çalışma zamanları.",
        size_bytes: 0, item_count: 2,
        command: "flatpak uninstall --unused -y", safety: "safe", status: "found",
        icon: "◐", color: "#00f0ff",
      },
    ],
  }),
  repo_list: () => ({
    native_kind: "apt",
    native: [
      { kind: "apt", id: "deb::http://archive.ubuntu.com/ubuntu::noble", name: "deb noble (main restricted universe multiverse)", url: "http://archive.ubuntu.com/ubuntu", enabled: true, source_path: "/etc/apt/sources.list", gpg_check: null, official: false },
      { kind: "apt", id: "deb::http://security.ubuntu.com/ubuntu::noble-security", name: "deb noble-security (main restricted)", url: "http://security.ubuntu.com/ubuntu", enabled: true, source_path: "/etc/apt/sources.list", gpg_check: null, official: false },
      { kind: "apt", id: "deb::https://download.docker.com/linux/ubuntu::noble", name: "deb noble (stable)", url: "https://download.docker.com/linux/ubuntu", enabled: true, source_path: "/etc/apt/sources.list.d/docker.list", gpg_check: null, official: false },
      { kind: "apt", id: "deb::http://ppa.launchpad.net/git-core/ppa/ubuntu::noble", name: "deb noble (main)", url: "http://ppa.launchpad.net/git-core/ppa/ubuntu", enabled: false, source_path: "/etc/apt/sources.list.d/git-core.list", gpg_check: null, official: false },
    ],
    flatpak: [
      { kind: "flatpak", id: "flathub", name: "flathub", url: "https://dl.flathub.org/repo/", enabled: true, source_path: "flatpak remotes", gpg_check: null, official: true },
      { kind: "flatpak", id: "flathub-beta", name: "flathub-beta", url: "https://dl.flathub.org/beta-repo/", enabled: true, source_path: "flatpak remotes", gpg_check: null, official: false },
      { kind: "flatpak", id: "fedora", name: "fedora", url: "oci+https://registry.fedoraproject.org", enabled: false, source_path: "flatpak remotes", gpg_check: null, official: false },
    ],
  }),
  package_overview: () => ({
    native: {
      kind: "apt",
      installed: true,
      version: "apt 2.7.14 (amd64)",
      installed_count: 2147,
      repo_config_path: "/etc/apt/sources.list.d/",
    },
    flatpak: {
      installed: true,
      version: "Flatpak 1.14.6",
      remotes: [
        { name: "flathub", url: "https://dl.flathub.org/repo/" },
        { name: "flathub-beta", url: "https://dl.flathub.org/beta-repo/" },
        { name: "fedora", url: "oci+https://registry.fedoraproject.org" },
      ],
      installed_count: 12,
      has_flathub: true,
    },
    snap: {
      installed: false,
      service_active: false,
      version: null,
      installed_count: null,
    },
    recommendations: [
      {
        id: "flatpak-ok",
        severity: "good",
        title: "Flatpak hazır",
        body: "Flathub bağlı. Şu an 12 uygulama kurulu.",
        action_label: null,
        action_command: null,
      },
      {
        id: "snap-optional",
        severity: "info",
        title: "Snap kurulu değil (opsiyonel)",
        body: "Snap, Canonical'ın paket biçimi. Linux üzerinde Flatpak'e göre daha az popüler ama bazı uygulamalar (Spotify, Postman) burada bulunur.",
        action_label: "Snap'i kur (opsiyonel)",
        action_command: "apt install -y snapd",
      },
    ],
  }),
  app_info: () => ({
    name: "Santral",
    version: "0.0.1",
    build: "preview-001",
    repo: "https://github.com/reverx99/santral",
    channel: "preview",
  }),
  distro_info: () => ({
    name: "Ubuntu",
    pretty_name: "Ubuntu 24.04.2 LTS",
    id: "ubuntu",
    id_like: ["debian"],
    version: "24.04.2 LTS (Noble Numbat)",
    version_id: "24.04",
    codename: "noble",
    package_manager: { kind: "apt", command: "apt", installed_count: 2147 },
    flatpak: { installed: true,  version: "Flatpak 1.14.6" },
    snap:    { installed: false, version: null },
  }),
  system_info: () => ({
    hostname: "santral-dev",
    kernel: "6.8.0-31-generic",
    os_name: "Linux (Ubuntu 24.04.2 LTS)",
    uptime_secs: 3 * 86400 + 7 * 3600 + 22 * 60,
    boot_time: Math.floor(Date.now() / 1000) - (3 * 86400 + 7 * 3600 + 22 * 60),
    user: "reverx",
    shell: "zsh",
    desktop: "GNOME",
    cpu: {
      model: "AMD Ryzen 7 5800X 8-Core Processor",
      cores_physical: 8,
      cores_logical: 16,
      frequency_mhz: 4250,
      usage_percent: 18.3,
      arch: "x86_64",
    },
    memory: {
      total_bytes:     32 * 1024 ** 3,
      used_bytes:      11.2 * 1024 ** 3,
      available_bytes: 20.4 * 1024 ** 3,
      usage_percent:   35.0,
    },
    swap: {
      total_bytes:  8 * 1024 ** 3,
      used_bytes:   0.4 * 1024 ** 3,
      usage_percent: 5.0,
    },
    disks: [
      { name: "nvme0n1p2", mount_point: "/",          fs_type: "ext4",  total_bytes: 480 * 1024 ** 3, available_bytes: 142 * 1024 ** 3, used_bytes: 338 * 1024 ** 3, usage_percent: 70.4, removable: false },
      { name: "nvme0n1p1", mount_point: "/boot/efi",  fs_type: "vfat",  total_bytes: 512 * 1024 ** 2, available_bytes: 360 * 1024 ** 2, used_bytes: 152 * 1024 ** 2, usage_percent: 29.7, removable: false },
      { name: "sda1",      mount_point: "/mnt/data",  fs_type: "btrfs", total_bytes: 2  * 1024 ** 4, available_bytes: 1.4 * 1024 ** 4, used_bytes: 0.6 * 1024 ** 4, usage_percent: 30.0, removable: false },
    ],
    load_avg: { one: 0.42, five: 0.31, fifteen: 0.27 },
    locale: {
      lang: "tr_TR.UTF-8",
      timezone: "Europe/Istanbul",
      local_time: "2026-05-10 18:42:31 +03",
    },
    services: {
      active: 142,
      inactive: 38,
      failed: 2,
      enabled: 119,
      failed_units: ["NetworkManager-wait-online.service", "fwupd-refresh.service"],
    },
    kernel_params_count: 1247,
    session_type: "wayland",
    boot_analyze: {
      total_ms: 12340,
      firmware_ms: 3200,
      loader_ms: 850,
      kernel_ms: 1620,
      initrd_ms: 2180,
      userspace_ms: 4490,
      target: "graphical",
      target_ms: 4490,
    },
    top_cpu: [
      { pid: 4421, name: "santral",     cpu_percent: 28.4, memory_bytes: 142 * 1024 ** 2 },
      { pid: 1834, name: "firefox",     cpu_percent: 18.2, memory_bytes: 1240 * 1024 ** 2 },
      { pid: 2911, name: "gnome-shell", cpu_percent: 6.8,  memory_bytes: 410 * 1024 ** 2 },
      { pid: 2056, name: "wireplumber", cpu_percent: 2.3,  memory_bytes: 22 * 1024 ** 2 },
      { pid: 1812, name: "Xwayland",    cpu_percent: 1.1,  memory_bytes: 64 * 1024 ** 2 },
    ],
    top_mem: [
      { pid: 1834, name: "firefox",     cpu_percent: 18.2, memory_bytes: 1240 * 1024 ** 2 },
      { pid: 4310, name: "code",        cpu_percent: 3.6,  memory_bytes: 720 * 1024 ** 2 },
      { pid: 2911, name: "gnome-shell", cpu_percent: 6.8,  memory_bytes: 410 * 1024 ** 2 },
      { pid: 4421, name: "santral",     cpu_percent: 28.4, memory_bytes: 142 * 1024 ** 2 },
      { pid: 1812, name: "Xwayland",    cpu_percent: 1.1,  memory_bytes: 64 * 1024 ** 2 },
    ],
  }),
  hardware_info: () => ({
    gpus: [
      { vendor: "NVIDIA Corporation", product: "GA106 [GeForce RTX 3060]", raw: "01:00.0 \"VGA compatible controller\" \"NVIDIA Corp.\" \"GA106 [GeForce RTX 3060]\"" },
      { vendor: "Advanced Micro Devices, Inc. [AMD/ATI]", product: "Cezanne [Radeon Graphics]", raw: "..." },
      { vendor: "Intel Corporation", product: "Raptor Lake-P [Iris Xe Graphics]", raw: "..." },
    ],
    audio: [
      { vendor: "NVIDIA Corporation", product: "GA106 High Definition Audio Controller", raw: "" },
      { vendor: "Advanced Micro Devices", product: "Family 17h HD Audio Controller", raw: "" },
    ],
    network: [
      { name: "lo",     mac: "00:00:00:00:00:00", state: "unknown", ipv4: ["127.0.0.1"], ipv6: ["::1"], kind: "loopback",
        rx_bytes: 1.2 * 1024**2, tx_bytes: 1.2 * 1024**2, rx_packets: 8421, tx_packets: 8421, speed_mbps: null },
      { name: "enp4s0", mac: "a8:a1:59:c4:7d:e3", state: "up",      ipv4: ["192.168.1.42"], ipv6: ["fe80::aaa1:59ff:fec4:7de3"], kind: "ethernet",
        rx_bytes: 18.4 * 1024**3, tx_bytes: 6.2 * 1024**3, rx_packets: 4_120_223, tx_packets: 2_840_109, speed_mbps: 1000 },
      { name: "wlp3s0", mac: "9c:b6:d0:1f:42:8a", state: "down",    ipv4: [], ipv6: [], kind: "wifi",
        rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0, speed_mbps: null },
      { name: "docker0",mac: "02:42:8a:1b:6c:5d", state: "down",    ipv4: ["172.17.0.1"], ipv6: [], kind: "virtual",
        rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0, speed_mbps: null },
    ],
    bluetooth: {
      adapter_present: true,
      adapter_name: "santral-dev",
      powered: true,
      service_active: true,
      raw_status: "Controller AA:BB:CC:DD:EE:FF\n\tName: santral-dev\n\tPowered: yes\n",
    },
    usb: [
      { vendor: "1d6b:0003 Linux Foundation 3.0 root hub", product: "", raw: "Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub" },
      { vendor: "046d:c52b Logitech, Inc. Unifying Receiver", product: "", raw: "Bus 001 Device 005: ID 046d:c52b Logitech, Inc. Unifying Receiver" },
      { vendor: "8087:0029 Intel Corp. AX200 Bluetooth", product: "", raw: "Bus 001 Device 004: ID 8087:0029 Intel Corp. AX200 Bluetooth" },
      { vendor: "0bda:8153 Realtek RTL8153 Gigabit Ethernet", product: "", raw: "Bus 002 Device 003: ID 0bda:8153 Realtek RTL8153 Gigabit Ethernet" },
    ],
    cpu_extra: {
      virtualization: null,
      flags_excerpt: ["AES", "AVX", "AVX2", "SHA_NI", "SVM"],
      microcode: "0xa201025",
    },
    battery: {
      name: "BAT0",
      vendor: "LGC",
      model: "01AV431",
      capacity_percent: 78,
      status: "Discharging",
      design_capacity: 57000,
      current_capacity: 48400,
      health_percent: 85,
      cycle_count: 312,
      ac_online: false,
    },
    thermal: {
      sensors: [
        { label: "x86_pkg_temp",  temperature_c: 62.5, kind: "cpu" },
        { label: "coretemp_core_0", temperature_c: 58.0, kind: "cpu" },
        { label: "amdgpu", temperature_c: 71.0, kind: "gpu" },
        { label: "nvme_composite", temperature_c: 44.0, kind: "nvme" },
        { label: "acpitz", temperature_c: 51.0, kind: "acpi" },
      ],
      fans: [
        { label: "thinkpad · fan1_input", rpm: 2840 },
        { label: "amdgpu · fan1_input",   rpm: 1620 },
      ],
    },
    secure_boot: { supported: true, enabled: true, source: "mokutil" },
    modules: {
      loaded: 184,
      examples: ["amdgpu", "snd_hda_intel", "iwlwifi", "btusb", "nvme", "ext4", "kvm_amd", "rfkill"],
    },
    uefi: true,
    displays: [
      { connector: "card0-DP-1",   status: "connected",    enabled: true,  current_mode: "2560x1440", modes_count: 14, preferred_mode: "2560x1440" },
      { connector: "card0-HDMI-A-1", status: "connected",  enabled: true,  current_mode: "1920x1080", modes_count: 22, preferred_mode: "1920x1080" },
      { connector: "card0-DP-2",   status: "disconnected", enabled: false, current_mode: null,        modes_count: 0,  preferred_mode: null },
    ],
    storage: [
      {
        name: "nvme0n1", kind: "NVMe",
        model: "Samsung SSD 970 EVO Plus 1TB",
        vendor: null, firmware: "2B2QEXM7",
        size_bytes: 1000 * 1024 ** 3,
        rotational: false, removable: false,
        temperature_c: 42.0,
        smart: {
          passed: true, source: "smartctl",
          power_on_hours: 3284, power_cycles: 412,
          percent_used: 6, available_spare: 100,
          data_read_bytes: 24.6 * 1024 ** 4,
          data_written_bytes: 11.8 * 1024 ** 4,
          temperature_c: 42.0,
          error: null,
        },
      },
      {
        name: "sda", kind: "SSD",
        model: "Crucial MX500 2TB",
        vendor: "ATA", firmware: "M3CR046",
        size_bytes: 2 * 1024 ** 4,
        rotational: false, removable: false,
        temperature_c: 38.0,
        smart: {
          passed: true, source: "smartctl",
          power_on_hours: 8742, power_cycles: 1208,
          percent_used: null, available_spare: null,
          data_read_bytes: null,
          data_written_bytes: null,
          temperature_c: 38.0,
          error: null,
        },
      },
      {
        name: "sdb", kind: "HDD",
        model: "WDC WD40EZRZ-00G",
        vendor: "ATA", firmware: "80.00A80",
        size_bytes: 4 * 1024 ** 4,
        rotational: true, removable: false,
        temperature_c: null,
        smart: { passed: false, source: "smartctl",
          power_on_hours: null, power_cycles: null,
          percent_used: null, available_spare: null,
          data_read_bytes: null, data_written_bytes: null, temperature_c: null,
          error: "smartctl root yetkisi istiyor — Faz 7'de polkit ile alınacak",
        },
      },
    ],
  }),
  app_search: ({ query }) => {
    const q = (query || "").toLowerCase();
    if (q.length < 2) return { query, native: [], flatpak: [], native_source: "apt", elapsed_ms: 0, limit: 60, truncated: false };
    const allNative = [
      { source: "apt", name: "firefox",         summary: "Safe and easy web browser from Mozilla", version: "117.0+linuxmint1+vera", remote: null },
      { source: "apt", name: "firefox-locale-tr", summary: "Mozilla Firefox - Turkish language pack", version: "117.0", remote: null },
      { source: "apt", name: "firefox-esr",     summary: "Mozilla Firefox web browser - Extended Support Release", version: "115.2.0esr", remote: null },
      { source: "apt", name: "thunderbird",     summary: "mail/news client with RSS, chat and integrated spam filter", version: "1:115.2.1", remote: null },
      { source: "apt", name: "chromium",        summary: "web browser", version: "117.0.5938.62", remote: null },
      { source: "apt", name: "vlc",             summary: "multimedia player and streamer", version: "3.0.18", remote: null },
      { source: "apt", name: "neovim",          summary: "heavily refactored vim fork", version: "0.7.2-7", remote: null },
      { source: "apt", name: "git",             summary: "fast, scalable, distributed revision control system", version: "1:2.34.1-1ubuntu1.10", remote: null },
      { source: "apt", name: "tilix",           summary: "Tiling terminal emulator using GTK+ 3", version: "1.9.6-2", remote: null },
    ].filter(h => (h.name + " " + h.summary).toLowerCase().includes(q));
    const allFlatpak = [
      { source: "flatpak", name: "org.mozilla.firefox",       label: "Firefox",            summary: "Fast, Private & Safe Web Browser", remote: "flathub",      version: "117.0" },
      { source: "flatpak", name: "com.brave.Browser",         label: "Brave Browser",       summary: "Secure, fast and private web browser", remote: "flathub",   version: "1.58.124" },
      { source: "flatpak", name: "io.gitlab.librewolf-community", label: "LibreWolf",       summary: "Privacy-focused Firefox fork",     remote: "flathub",     version: "117.0-1" },
      { source: "flatpak", name: "com.github.tchx84.Flatseal",label: "Flatseal",            summary: "Manage Flatpak permissions",       remote: "flathub",     version: "2.2.0"  },
      { source: "flatpak", name: "org.gnome.gitlab.somas.Apostrophe", label: "Apostrophe",  summary: "Markdown editor", remote: "flathub", version: "2.6.5" },
    ].filter(h => (h.name + " " + (h.label || "") + " " + (h.summary || "")).toLowerCase().includes(q));
    return {
      query, native: allNative, flatpak: allFlatpak,
      native_source: "apt",
      elapsed_ms: 480 + Math.floor(Math.random() * 600),
      limit: 60, truncated: false,
    };
  },
};

const invoke = async (cmd, args) => {
  // app_search canlı arama hissi için biraz daha uzun gecikme
  const delay = cmd === "app_search" ? 700 + Math.random() * 400 : 60;
  await new Promise((r) => setTimeout(r, delay));
  if (cmd === "app_catalog")  return await loadCatalog();
  if (cmd === "scan_catalog") return await loadScanners();
  if (cmd === "start_action") return await fakeStartAction(args || {});
  if (cmd === "list_tasks")   return Array.from(PREVIEW_TASKS.values());
  if (cmd === "clear_task")   { PREVIEW_TASKS.delete(args?.id); return true; }
  if (cmd === "clear_finished_tasks") {
    let n = 0;
    for (const [id, t] of Array.from(PREVIEW_TASKS)) {
      if (["succeeded","failed","cancelled","rejected"].includes(t.status)) {
        PREVIEW_TASKS.delete(id); n++;
      }
    }
    return n;
  }
  if (cmd === "cancel_task") {
    const t = PREVIEW_TASKS.get(args?.id);
    if (t && (t.status === "running" || t.status === "queued")) {
      t.status = "cancelled";
      t.ended_at = Math.floor(Date.now() / 1000);
      tasks.onTaskUpdate(t);
    }
    return true;
  }
  if (cmd === "check_updates") {
    await new Promise((r) => setTimeout(r, 600));
    return {
      native_kind: "apt",
      native_count: 14,
      flatpak_count: 3,
      snap_count: 0,
      total: 17,
      checked_at: Math.floor(Date.now() / 1000),
    };
  }
  if (!MOCK[cmd]) throw new Error("unknown command: " + cmd);
  return MOCK[cmd](args || {});
};

const ROUTES = {
  sistem:       { label: "Sistem",       render: renderSistem,       glyph: "▤" },
  donanim:      { label: "Donanım",      render: renderDonanim,      glyph: "⚙" },
  uygulamalar:  { label: "Uygulamalar",  render: renderUygulamalar,  glyph: "▥" },
  tarama:       { label: "Tarama",       render: renderTarama,       glyph: "▮" },
  paketler:     { label: "Paketler",     render: renderPaketler,     glyph: "⊞" },
  optimizasyon: { label: "Optimizasyon", render: renderOptimizasyon, glyph: "⚡" },
  repolar:      { label: "Repolar",      render: renderRepolar,      glyph: "≡" },
  suruculer:    { label: "Sürücüler",    render: renderSuruculer,    glyph: "◈" },
  ayarlar:      { label: "Ayarlar",      render: renderAyarlar,      glyph: "▣" },
  hakkinda:     { label: "Hakkında",     render: renderHakkinda,     glyph: "∞" },
};

palette.register(Object.entries(ROUTES).map(([id, r]) => ({
  id: `route:${id}`,
  label: r.label,
  hint: "bölüme git",
  group: "Bölümler",
  glyph: r.glyph,
  action: () => { history.replaceState(null, "", `#${id}`); navigate(id); },
})));

const $page    = document.getElementById("page");
const $tag     = document.getElementById("brand-tag");
const $navBtns = Array.from(document.querySelectorAll(".nav-item"));

const setActiveNav = (route) => {
  $navBtns.forEach((b) => b.classList.toggle("active", b.dataset.route === route));
};

let current = null;
const navigate = async (route) => {
  if (!ROUTES[route]) route = "sistem";
  if (route === current) return;
  current = route;
  setActiveNav(route);
  $page.innerHTML = `<div class="loading"><span class="loader"></span><span>${ROUTES[route].label} yükleniyor…</span></div>`;
  $page.__invoke = invoke;
  try {
    await ROUTES[route].render($page, { invoke });
  } catch (err) {
    $page.innerHTML = `<div class="err">preview hata: ${String(err?.message || err)}</div>`;
    console.error(err);
  }
};

// preview için task altyapısını mount et — listen yok, sadece invoke
mountTaskDrawer();
await tasks.init({ invoke });

const info = await invoke("app_info");
$tag.textContent = `v${info.version}`;

$navBtns.forEach((btn) => {
  if (btn.disabled) return;
  btn.addEventListener("click", () => {
    const r = btn.dataset.route;
    if (r) {
      history.replaceState(null, "", `#${r}`);
      navigate(r);
    }
  });
});

window.addEventListener("hashchange", () => {
  navigate(location.hash.replace(/^#/, "") || "sistem");
});

// dışarıdan playwright ile geçiş yapmak için
window.__santralGo = navigate;

navigate(location.hash.replace(/^#/, "") || "sistem");
