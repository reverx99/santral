// preview entry — Tauri olmadan tarayıcıda mock veriyle render etmek için.
// Sadece UI'yi göstermeye yarar; sürüme hiçbir etkisi yoktur.

import { renderSistem }       from "./pages/sistem.js";
import { renderDonanim }      from "./pages/donanim.js";
import { renderUygulamalar }  from "./pages/uygulamalar.js";
import { renderTarama }       from "./pages/tarama.js";
import { renderPaketler }     from "./pages/paketler.js";
import { renderOptimizasyon } from "./pages/optimizasyon.js";
import { renderRepolar }      from "./pages/repolar.js";
import { renderAyarlar }      from "./pages/ayarlar.js";
import { renderHakkinda }     from "./pages/hakkinda.js";
import { settings }           from "./settings.js";
import { toast }              from "./toast.js";
import { palette }            from "./palette.js";

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
  }),
  hardware_info: () => ({
    gpus: [
      { vendor: "NVIDIA Corporation", product: "GA106 [GeForce RTX 3060]", raw: "01:00.0 \"VGA compatible controller\" \"NVIDIA Corp.\" \"GA106 [GeForce RTX 3060]\"" },
      { vendor: "Advanced Micro Devices, Inc. [AMD/ATI]", product: "Cezanne [Radeon Graphics]", raw: "..." },
    ],
    audio: [
      { vendor: "NVIDIA Corporation", product: "GA106 High Definition Audio Controller", raw: "" },
      { vendor: "Advanced Micro Devices", product: "Family 17h HD Audio Controller", raw: "" },
    ],
    network: [
      { name: "lo",     mac: "00:00:00:00:00:00", state: "unknown", ipv4: ["127.0.0.1"], ipv6: ["::1"], kind: "loopback" },
      { name: "enp4s0", mac: "a8:a1:59:c4:7d:e3", state: "up",      ipv4: ["192.168.1.42"], ipv6: ["fe80::aaa1:59ff:fec4:7de3"], kind: "ethernet" },
      { name: "wlp3s0", mac: "9c:b6:d0:1f:42:8a", state: "down",    ipv4: [], ipv6: [], kind: "wifi" },
      { name: "docker0",mac: "02:42:8a:1b:6c:5d", state: "down",    ipv4: ["172.17.0.1"], ipv6: [], kind: "virtual" },
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
  }),
};

const invoke = async (cmd) => {
  await new Promise((r) => setTimeout(r, 60));
  if (cmd === "app_catalog")  return await loadCatalog();
  if (cmd === "scan_catalog") return await loadScanners();
  if (!MOCK[cmd]) throw new Error("unknown command: " + cmd);
  return MOCK[cmd]();
};

const ROUTES = {
  sistem:       { label: "Sistem",       render: renderSistem,       glyph: "▤" },
  donanim:      { label: "Donanım",      render: renderDonanim,      glyph: "⚙" },
  uygulamalar:  { label: "Uygulamalar",  render: renderUygulamalar,  glyph: "▥" },
  tarama:       { label: "Tarama",       render: renderTarama,       glyph: "▮" },
  paketler:     { label: "Paketler",     render: renderPaketler,     glyph: "⊞" },
  optimizasyon: { label: "Optimizasyon", render: renderOptimizasyon, glyph: "⚡" },
  repolar:      { label: "Repolar",      render: renderRepolar,      glyph: "≡" },
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
