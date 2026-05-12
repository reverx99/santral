// SÜRÜCÜLER sayfası — GPU sürücüleri, multimedya codec'leri, sistem ön-koşul
// depoları (RPM Fusion vb.). Algılanan GPU + distro ailesine göre uygun
// öneri kartlarını üretir.

import { pageHead, sectionHead, esc } from "../util.js";
import { tasks } from "../tasks.js";

export async function renderSuruculer(host, { invoke }) {
  const [distro, hw] = await Promise.all([
    invoke("distro_info"),
    invoke("hardware_info"),
  ]);

  const family = distro.package_manager?.kind || "unknown"; // apt/dnf/pacman/zypper
  const gpus = hw.gpus || [];
  const vendors = new Set(gpus.map((g) => gpuVendor(g)));
  const flathub = (distro.flatpak?.installed && (distro.flatpak.version || "")) ? true : false;

  host.innerHTML = `
    ${pageHead({
      num: "// 08",
      title: "SÜRÜCÜLER",
      actions: `<button class="btn" id="refresh">⟲ Yenile</button>`,
    })}

    <p class="page-lede">
      <strong>${esc(family.toUpperCase())}</strong> ailesi tespit edildi.
      Algılanan GPU: ${esc(gpus.map((g) => g.product || g.vendor).join(", ") || "—")}.
      Aşağıdaki öneriler, donanım + distro kombinasyonuna göre filtrelenmiştir.
    </p>

    ${vendors.has("nvidia") ? `
      ${sectionHead("NVIDIA sürücüleri")}
      <div class="cards">${nvidiaCardsFor(family)}</div>
    ` : ""}

    ${vendors.has("amd") ? `
      ${sectionHead("AMD / Radeon sürücüleri")}
      <div class="cards">${amdCardsFor(family)}</div>
    ` : ""}

    ${vendors.has("intel") ? `
      ${sectionHead("Intel grafik")}
      <div class="cards">${intelCardsFor(family)}</div>
    ` : ""}

    ${sectionHead("Multimedya codec'leri")}
    <div class="cards">${codecsCardsFor(family)}</div>

    ${family === "dnf" ? `
      ${sectionHead("Ön koşullar")}
      <div class="cards">
        ${rpmFusionCard()}
      </div>
    ` : ""}
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => renderSuruculer(host, { invoke }));
  host.querySelectorAll("[data-action-kind]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.actionKind;
      const pkgs = (btn.dataset.actionPkgs || "").split(",").map((s) => s.trim()).filter(Boolean);
      const label = btn.dataset.actionLabel || kind;
      try {
        await tasks.start({ kind, args: pkgs, label });
      } catch {}
    });
  });
}

function gpuVendor(g) {
  const v = ((g.vendor || "") + " " + (g.product || "")).toLowerCase();
  if (v.includes("nvidia")) return "nvidia";
  if (v.includes("amd") || v.includes("ati") || v.includes("radeon")) return "amd";
  if (v.includes("intel")) return "intel";
  return "other";
}

/* ---------- NVIDIA ---------- */

function nvidiaCardsFor(family) {
  switch (family) {
    case "apt":
      return driverCard({
        color: "#66ff99",
        title: "Otomatik kur (ubuntu-drivers)",
        sub: "Donanımına en uygun NVIDIA sürücüsünü otomatik seçer ve kurar. Önerilen yol.",
        cmd: "sudo ubuntu-drivers autoinstall",
        kind: "drivers.ubuntu-autoinstall",
      })
      + driverCard({
        color: "#ff0099",
        title: "Belirli sürüm: nvidia-driver-550",
        sub: "Yeni sürüm. Çok yeni ya da çok eski kartlarda otomatik kur tercih et.",
        cmd: "sudo apt install -y nvidia-driver-550",
        kind: "apt.install", pkgs: ["nvidia-driver-550"],
      })
      + driverCard({
        color: "#b400ff",
        title: "Eski sürüm: nvidia-driver-535",
        sub: "Eski Maxwell/Pascal kartlar veya kararlılık tercihi.",
        cmd: "sudo apt install -y nvidia-driver-535",
        kind: "apt.install", pkgs: ["nvidia-driver-535"],
      });

    case "dnf":
      return driverCard({
        color: "#66ff99",
        title: "akmod-nvidia (RPM Fusion)",
        sub: "Fedora resmi yolu. RPM Fusion etkinleştirilmiş olmalı. Modülü kernel'in için dinamik derler.",
        cmd: "sudo dnf install -y akmod-nvidia",
        kind: "dnf.install", pkgs: ["akmod-nvidia"],
      })
      + driverCard({
        color: "#00f0ff",
        title: "CUDA desteği ekle",
        sub: "Sürücüye ek olarak CUDA toolkit. Makine öğrenmesi, video kodlama (NVENC) için.",
        cmd: "sudo dnf install -y xorg-x11-drv-nvidia-cuda",
        kind: "dnf.install", pkgs: ["xorg-x11-drv-nvidia-cuda"],
      });

    case "pacman":
      return driverCard({
        color: "#66ff99",
        title: "Standart: nvidia + nvidia-utils",
        sub: "Resmi paketler. Stable kernel kullanıyorsan ideal.",
        cmd: "sudo pacman -S --noconfirm nvidia nvidia-utils",
        kind: "pacman.install", pkgs: ["nvidia", "nvidia-utils"],
      })
      + driverCard({
        color: "#00f0ff",
        title: "DKMS: nvidia-dkms",
        sub: "linux-zen / linux-lts / custom kernel kullanıcıları için. Kernel her güncellendiğinde modül yeniden derlenir.",
        cmd: "sudo pacman -S --noconfirm nvidia-dkms nvidia-utils",
        kind: "pacman.install", pkgs: ["nvidia-dkms", "nvidia-utils"],
      });

    case "zypper":
      return driverCard({
        color: "#66ff99",
        title: "x11-video-nvidiaG06",
        sub: "openSUSE NVIDIA reposundan resmi sürücü paketi.",
        cmd: "sudo zypper install -y x11-video-nvidiaG06",
        kind: "zypper.install", pkgs: ["x11-video-nvidiaG06"],
      });

    default:
      return `<div class="muted">Bu distro için NVIDIA sürücü önerisi yok. Distro'nun resmi belgelerine bak.</div>`;
  }
}

/* ---------- AMD ---------- */

function amdCardsFor(family) {
  switch (family) {
    case "apt":
      return driverCard({
        color: "#00f0ff",
        title: "Mesa + Vulkan (AMDGPU)",
        sub: "Açık kaynak AMDGPU sürücüsü, Mesa ve Vulkan paketleri. Modern AMD kartlar için resmi yol.",
        cmd: "sudo apt install -y mesa-vulkan-drivers libvulkan1 vulkan-tools mesa-utils",
        kind: "apt.install",
        pkgs: ["mesa-vulkan-drivers", "libvulkan1", "vulkan-tools", "mesa-utils"],
      });
    case "dnf":
      return driverCard({
        color: "#00f0ff",
        title: "Mesa + Vulkan",
        sub: "Fedora'da AMDGPU varsayılan; bu paket eksikleri tamamlar.",
        cmd: "sudo dnf install -y mesa-vulkan-drivers vulkan-tools mesa-libGL",
        kind: "dnf.install",
        pkgs: ["mesa-vulkan-drivers", "vulkan-tools", "mesa-libGL"],
      });
    case "pacman":
      return driverCard({
        color: "#00f0ff",
        title: "Mesa + Vulkan radv",
        sub: "Arch'ta AMDGPU + Vulkan radv paketleri.",
        cmd: "sudo pacman -S --noconfirm mesa vulkan-radeon vulkan-tools",
        kind: "pacman.install",
        pkgs: ["mesa", "vulkan-radeon", "vulkan-tools"],
      });
    case "zypper":
      return driverCard({
        color: "#00f0ff",
        title: "Mesa + Vulkan",
        sub: "openSUSE için açık kaynak AMD desteği.",
        cmd: "sudo zypper install -y Mesa-libVulkan-devel vulkan-tools",
        kind: "zypper.install",
        pkgs: ["Mesa-libVulkan-devel", "vulkan-tools"],
      });
    default:
      return `<div class="muted">AMD için bu distro öneri yok.</div>`;
  }
}

/* ---------- Intel ---------- */

function intelCardsFor(family) {
  switch (family) {
    case "apt":
      return driverCard({
        color: "#ffd400",
        title: "Intel medya hızlandırma",
        sub: "intel-media-va-driver: VA-API üzerinden donanımsal video çözme. YouTube / film izlerken CPU yükünü düşürür.",
        cmd: "sudo apt install -y intel-media-va-driver-non-free i965-va-driver vainfo",
        kind: "apt.install",
        pkgs: ["intel-media-va-driver-non-free", "i965-va-driver", "vainfo"],
      });
    case "dnf":
      return driverCard({
        color: "#ffd400",
        title: "intel-media-driver (libva)",
        sub: "RPM Fusion gereklidir.",
        cmd: "sudo dnf install -y intel-media-driver libva-utils",
        kind: "dnf.install",
        pkgs: ["intel-media-driver", "libva-utils"],
      });
    case "pacman":
      return driverCard({
        color: "#ffd400",
        title: "intel-media-driver",
        sub: "Vulkan ANV ve VA-API ile birlikte.",
        cmd: "sudo pacman -S --noconfirm intel-media-driver vulkan-intel libva-utils",
        kind: "pacman.install",
        pkgs: ["intel-media-driver", "vulkan-intel", "libva-utils"],
      });
    case "zypper":
      return driverCard({
        color: "#ffd400",
        title: "intel-media-driver",
        sub: "openSUSE Intel medya hızlandırma.",
        cmd: "sudo zypper install -y intel-media-driver libva-utils",
        kind: "zypper.install",
        pkgs: ["intel-media-driver", "libva-utils"],
      });
    default:
      return `<div class="muted">Intel için bu distro öneri yok.</div>`;
  }
}

/* ---------- Codec'ler ---------- */

function codecsCardsFor(family) {
  switch (family) {
    case "apt":
      return driverCard({
        color: "#ff0099",
        title: "ubuntu-restricted-extras",
        sub: "MP3, MP4, AVI, fontlar, Flash, codec'ler için Ubuntu standart paket. EULA onayı isteyebilir.",
        cmd: "sudo apt install -y ubuntu-restricted-extras",
        kind: "apt.install",
        pkgs: ["ubuntu-restricted-extras"],
      });
    case "dnf":
      return driverCard({
        color: "#ff0099",
        title: "ffmpeg + codec'ler (RPM Fusion)",
        sub: "RPM Fusion etkinleştirilmiş olmalı. ffmpeg, gstreamer eklentileri, libdvdcss.",
        cmd: "sudo dnf install -y ffmpeg gstreamer1-plugins-{bad-*,good-*,ugly-free,base} lame libdvdcss",
        kind: "dnf.install",
        pkgs: ["ffmpeg", "gstreamer1-plugins-bad-free", "gstreamer1-plugins-ugly", "gstreamer1-plugins-good", "lame", "libdvdcss"],
      });
    case "pacman":
      return driverCard({
        color: "#ff0099",
        title: "ffmpeg + GStreamer paketleri",
        sub: "Arch'ta codec desteği için tam set.",
        cmd: "sudo pacman -S --noconfirm ffmpeg gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav",
        kind: "pacman.install",
        pkgs: ["ffmpeg", "gst-plugins-good", "gst-plugins-bad", "gst-plugins-ugly", "gst-libav"],
      });
    case "zypper":
      return driverCard({
        color: "#ff0099",
        title: "Packman codec'leri",
        sub: "openSUSE'da Packman reposu önerilir. Sonra ffmpeg-4 kurulabilir.",
        cmd: "sudo zypper install -y ffmpeg-4 libavcodec57 libavformat57 lame",
        kind: "zypper.install",
        pkgs: ["ffmpeg-4", "libavcodec57", "libavformat57", "lame"],
      });
    default:
      return `<div class="muted">Codec öneri yok.</div>`;
  }
}

/* ---------- RPM Fusion (Fedora ön koşulu) ---------- */

function rpmFusionCard() {
  return driverCard({
    color: "#66ff99",
    title: "RPM Fusion (free + nonfree)",
    sub: "Fedora'da NVIDIA, codec, Steam, vb. kapalı kaynak paketler için zorunlu üçüncü parti repo. Topluluğa açık, güvenli ve resmi olarak önerilen yol.",
    cmd: "sudo dnf install -y https://mirrors.rpmfusion.org/free/...  https://mirrors.rpmfusion.org/nonfree/...",
    kind: "rpmfusion.enable",
  });
}

/* ---------- Ortak kart şablonu ---------- */

function driverCard({ color, title, sub, cmd, kind, pkgs }) {
  const pkgsAttr = (pkgs || []).join(",");
  return `
    <article class="card fade-in" style="--c:${esc(color)}">
      <div class="card-head"><span>Sürücü</span></div>
      <h3 class="card-title" style="font-size: 22px;">${esc(title)}</h3>
      <p class="card-sub">${esc(sub)}</p>
      <details class="opt-cmd" style="margin-top:8px">
        <summary>Çalıştırılacak komut</summary>
        <code>${esc(cmd)}</code>
      </details>
      <div style="margin-top:12px">
        <button class="btn install-btn"
          data-action-kind="${esc(kind)}"
          data-action-pkgs="${esc(pkgsAttr)}"
          data-action-label="${esc(title)}">
          ▶ Kur
        </button>
      </div>
    </article>
  `;
}
