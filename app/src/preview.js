// preview entry — Tauri olmadan tarayıcıda mock veriyle render etmek için.
// Sadece UI'yi göstermeye yarar; sürüme hiçbir etkisi yoktur.

import { renderSistem }      from "./pages/sistem.js";
import { renderDonanim }     from "./pages/donanim.js";
import { renderUygulamalar } from "./pages/uygulamalar.js";
import { renderHakkinda }    from "./pages/hakkinda.js";

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

const MOCK = {
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
  }),
};

const invoke = async (cmd) => {
  if (cmd === "app_catalog") {
    await new Promise((r) => setTimeout(r, 60));
    return await loadCatalog();
  }
  if (!MOCK[cmd]) throw new Error("unknown command: " + cmd);
  await new Promise((r) => setTimeout(r, 60));
  return MOCK[cmd]();
};

const ROUTES = {
  sistem:      { label: "SİSTEM",      render: renderSistem },
  donanim:     { label: "DONANIM",     render: renderDonanim },
  uygulamalar: { label: "UYGULAMALAR", render: renderUygulamalar },
  hakkinda:    { label: "HAKKINDA",    render: renderHakkinda },
};

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
