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

    ${sectionHead("Güç ve termal (laptop)")}
    <div class="cards">${powerCardsFor(family)}</div>

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
  // Vendor + product birleşik metni üzerinde \b ile kelime sınırı eşleme:
  // "corporation" içindeki "ati" gibi yanlış eşleşmelere karşı koruma.
  const v = ((g.vendor || "") + " " + (g.product || "")).toLowerCase();
  if (/\bnvidia\b/.test(v)) return "nvidia";
  if (/\b(amd|ati|radeon)\b/.test(v)) return "amd";
  if (/\bintel\b/.test(v)) return "intel";
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
      return [
        driverCard({
          color: "#00f0ff",
          title: "Mesa + Vulkan (AMDGPU)",
          sub: "Açık kaynak AMDGPU sürücüsü, Mesa ve Vulkan paketleri. Modern AMD kartlar için resmi yol.",
          cmd: "sudo apt install -y mesa-vulkan-drivers libvulkan1 vulkan-tools mesa-utils",
          kind: "apt.install",
          pkgs: ["mesa-vulkan-drivers", "libvulkan1", "vulkan-tools", "mesa-utils"],
        }),
        driverCard({
          color: "#b400ff",
          title: "AMD VA-API (donanımsal video)",
          sub: "mesa-va-drivers — AMD GPU üzerinde donanımsal video çöz/kodla. RDNA2+ AV1, H.265 ve H.264.",
          cmd: "sudo apt install -y mesa-va-drivers vainfo",
          kind: "apt.install",
          pkgs: ["mesa-va-drivers", "vainfo"],
        }),
      ].join("");
    case "dnf":
      return [
        driverCard({
          color: "#00f0ff",
          title: "Mesa + Vulkan",
          sub: "Fedora'da AMDGPU varsayılan; bu paket eksikleri tamamlar.",
          cmd: "sudo dnf install -y mesa-vulkan-drivers vulkan-tools mesa-libGL",
          kind: "dnf.install",
          pkgs: ["mesa-vulkan-drivers", "vulkan-tools", "mesa-libGL"],
        }),
        driverCard({
          color: "#b400ff",
          title: "AMD VA-API",
          sub: "mesa-va-drivers (RPM Fusion'da freeworld varyantı daha kapsamlı).",
          cmd: "sudo dnf install -y mesa-va-drivers libva-utils",
          kind: "dnf.install",
          pkgs: ["mesa-va-drivers", "libva-utils"],
        }),
      ].join("");
    case "pacman":
      return [
        driverCard({
          color: "#00f0ff",
          title: "Mesa + Vulkan radv",
          sub: "Arch'ta AMDGPU + Vulkan radv paketleri.",
          cmd: "sudo pacman -S --noconfirm mesa vulkan-radeon vulkan-tools",
          kind: "pacman.install",
          pkgs: ["mesa", "vulkan-radeon", "vulkan-tools"],
        }),
        driverCard({
          color: "#b400ff",
          title: "AMD VA-API",
          sub: "libva-mesa-driver — AMD donanımsal video.",
          cmd: "sudo pacman -S --noconfirm libva-mesa-driver libva-utils",
          kind: "pacman.install",
          pkgs: ["libva-mesa-driver", "libva-utils"],
        }),
      ].join("");
    case "zypper":
      return [
        driverCard({
          color: "#00f0ff",
          title: "Mesa + Vulkan",
          sub: "openSUSE için açık kaynak AMD desteği.",
          cmd: "sudo zypper install -y Mesa-libVulkan-devel vulkan-tools",
          kind: "zypper.install",
          pkgs: ["Mesa-libVulkan-devel", "vulkan-tools"],
        }),
      ].join("");
    default:
      return `<div class="muted">AMD için bu distro öneri yok.</div>`;
  }
}

/* ---------- Intel ---------- */

function intelCardsFor(family) {
  switch (family) {
    case "apt":
      return [
        driverCard({
          color: "#ffd400",
          title: "Intel medya hızlandırma (VA-API)",
          sub: "Intel Quick Sync üzerinden donanımsal video çöz/kodla. YouTube/film izlerken CPU yerine iGPU çalışır, batarya uzar.",
          cmd: "sudo apt install -y intel-media-va-driver-non-free i965-va-driver vainfo libva-drm2",
          kind: "apt.install",
          pkgs: ["intel-media-va-driver-non-free", "i965-va-driver", "vainfo", "libva-drm2"],
        }),
        driverCard({
          color: "#00f0ff",
          title: "Vulkan Intel (ANV)",
          sub: "mesa-vulkan-drivers — modern oyunlar (DXVK / Proton) için zorunlu.",
          cmd: "sudo apt install -y mesa-vulkan-drivers libvulkan1 vulkan-tools",
          kind: "apt.install",
          pkgs: ["mesa-vulkan-drivers", "libvulkan1", "vulkan-tools"],
        }),
        driverCard({
          color: "#b400ff",
          title: "OpenCL — Intel Compute Runtime",
          sub: "intel-opencl-icd: AI/ML, Blender, Darktable, GIMP gibi araçlar iGPU'yu hesaplama birimi olarak kullanabilir.",
          cmd: "sudo apt install -y intel-opencl-icd clinfo",
          kind: "apt.install",
          pkgs: ["intel-opencl-icd", "clinfo"],
        }),
        driverCard({
          color: "#ff0099",
          title: "GPU izleme: intel_gpu_top",
          sub: "intel-gpu-tools paketi. htop benzeri ama Intel iGPU için — render meşguliyeti, video engine kullanımı, frekanslar.",
          cmd: "sudo apt install -y intel-gpu-tools",
          kind: "apt.install",
          pkgs: ["intel-gpu-tools"],
        }),
        driverCard({
          color: "#66ff99",
          title: "intel-microcode",
          sub: "İşlemci mikrokod güncellemeleri. Spectre/Meltdown güvenlik açıkları için zorunlu; ayrıca kararlılık ve düşük seviye performans için önemli.",
          cmd: "sudo apt install -y intel-microcode",
          kind: "apt.install",
          pkgs: ["intel-microcode"],
        }),
      ].join("");

    case "dnf":
      return [
        driverCard({
          color: "#ffd400",
          title: "intel-media-driver (VA-API)",
          sub: "RPM Fusion gereklidir. Quick Sync ile donanımsal video çöz/kodla. Yeni Gen kartlar için. Eski (Gen 8 öncesi) için libva-intel-driver da gerekebilir.",
          cmd: "sudo dnf install -y intel-media-driver libva-utils libva-intel-driver",
          kind: "dnf.install",
          pkgs: ["intel-media-driver", "libva-utils", "libva-intel-driver"],
        }),
        driverCard({
          color: "#00f0ff",
          title: "Vulkan Intel (ANV)",
          sub: "mesa-vulkan-drivers — DXVK/Proton ve modern Vulkan oyunları için.",
          cmd: "sudo dnf install -y mesa-vulkan-drivers vulkan-tools",
          kind: "dnf.install",
          pkgs: ["mesa-vulkan-drivers", "vulkan-tools"],
        }),
        driverCard({
          color: "#b400ff",
          title: "OpenCL — intel-compute-runtime",
          sub: "AI/ML, Blender, Darktable iGPU üzerinden hesaplama. ocl-icd OpenCL loader.",
          cmd: "sudo dnf install -y intel-compute-runtime ocl-icd clinfo",
          kind: "dnf.install",
          pkgs: ["intel-compute-runtime", "ocl-icd", "clinfo"],
        }),
        driverCard({
          color: "#ff0099",
          title: "GPU izleme: intel_gpu_top",
          sub: "Intel GPU kullanımını canlı izleme aracı.",
          cmd: "sudo dnf install -y intel-gpu-tools",
          kind: "dnf.install",
          pkgs: ["intel-gpu-tools"],
        }),
        driverCard({
          color: "#66ff99",
          title: "microcode_ctl (mikrokod güncellemeleri)",
          sub: "Fedora'da genelde varsayılan kurulu. Yoksa açık güvenlik açıkları için kur.",
          cmd: "sudo dnf install -y microcode_ctl",
          kind: "dnf.install",
          pkgs: ["microcode_ctl"],
        }),
      ].join("");

    case "pacman":
      return [
        driverCard({
          color: "#ffd400",
          title: "intel-media-driver (VA-API)",
          sub: "Arch'ta Quick Sync için. Eski donanım (Gen 8 öncesi) için libva-intel-driver alternatif.",
          cmd: "sudo pacman -S --noconfirm intel-media-driver libva-utils",
          kind: "pacman.install",
          pkgs: ["intel-media-driver", "libva-utils"],
        }),
        driverCard({
          color: "#00f0ff",
          title: "Vulkan Intel (ANV)",
          sub: "vulkan-intel — modern oyunlar (DXVK) için.",
          cmd: "sudo pacman -S --noconfirm vulkan-intel vulkan-tools",
          kind: "pacman.install",
          pkgs: ["vulkan-intel", "vulkan-tools"],
        }),
        driverCard({
          color: "#b400ff",
          title: "OpenCL — intel-compute-runtime",
          sub: "Intel iGPU üzerinde OpenCL hesaplama. Blender/Darktable ve ML.",
          cmd: "sudo pacman -S --noconfirm intel-compute-runtime ocl-icd clinfo",
          kind: "pacman.install",
          pkgs: ["intel-compute-runtime", "ocl-icd", "clinfo"],
        }),
        driverCard({
          color: "#ff0099",
          title: "intel-gpu-tools",
          sub: "intel_gpu_top: canlı GPU kullanım izleme.",
          cmd: "sudo pacman -S --noconfirm intel-gpu-tools",
          kind: "pacman.install",
          pkgs: ["intel-gpu-tools"],
        }),
        driverCard({
          color: "#66ff99",
          title: "intel-ucode",
          sub: "İşlemci mikrokod paketi. /boot'a kopyalanır, bootloader (grub/systemd-boot) tarafından yüklenir. Güvenlik+kararlılık için zorunlu.",
          cmd: "sudo pacman -S --noconfirm intel-ucode",
          kind: "pacman.install",
          pkgs: ["intel-ucode"],
        }),
      ].join("");

    case "zypper":
      return [
        driverCard({
          color: "#ffd400",
          title: "intel-media-driver (VA-API)",
          sub: "openSUSE Quick Sync paketleri.",
          cmd: "sudo zypper install -y intel-media-driver libva-utils",
          kind: "zypper.install",
          pkgs: ["intel-media-driver", "libva-utils"],
        }),
        driverCard({
          color: "#00f0ff",
          title: "Vulkan Intel + Mesa",
          sub: "openSUSE'da Vulkan ve Mesa GL paketleri.",
          cmd: "sudo zypper install -y Mesa-libVulkan-devel vulkan-tools",
          kind: "zypper.install",
          pkgs: ["Mesa-libVulkan-devel", "vulkan-tools"],
        }),
        driverCard({
          color: "#b400ff",
          title: "OpenCL — Intel iGPU",
          sub: "openSUSE'da OpenCL desteği.",
          cmd: "sudo zypper install -y intel-opencl clinfo",
          kind: "zypper.install",
          pkgs: ["intel-opencl", "clinfo"],
        }),
        driverCard({
          color: "#ff0099",
          title: "intel-gpu-tools",
          sub: "intel_gpu_top ve GPU izleme.",
          cmd: "sudo zypper install -y intel-gpu-tools",
          kind: "zypper.install",
          pkgs: ["intel-gpu-tools"],
        }),
        driverCard({
          color: "#66ff99",
          title: "ucode-intel (mikrokod)",
          sub: "İşlemci mikrokod güncellemeleri.",
          cmd: "sudo zypper install -y ucode-intel",
          kind: "zypper.install",
          pkgs: ["ucode-intel"],
        }),
      ].join("");

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

/* ---------- Güç & termal (laptop/iGPU) ---------- */

function powerCardsFor(family) {
  // thermald, tlp ve power-profiles-daemon — özellikle Intel iGPU
  // laptop'larda anlamlı. AMD Ryzen laptop için power-profiles-daemon iyi.
  switch (family) {
    case "apt":
      return [
        driverCard({
          color: "#00f0ff",
          title: "power-profiles-daemon",
          sub: "GNOME/KDE güç profili menüsünü besler. 'Performans / Dengeli / Güç Tasarrufu' geçişi tek tıkla.",
          cmd: "sudo apt install -y power-profiles-daemon",
          kind: "apt.install",
          pkgs: ["power-profiles-daemon"],
        }),
        driverCard({
          color: "#ffd400",
          title: "thermald (Intel termal kontrolü)",
          sub: "Intel CPU sıcaklığını proaktif yönetir, throttling'i optimum noktada tetikler. Laptop'larda performans + sessizlik.",
          cmd: "sudo apt install -y thermald",
          kind: "apt.install",
          pkgs: ["thermald"],
        }),
        driverCard({
          color: "#b400ff",
          title: "TLP (gelişmiş güç yönetimi)",
          sub: "Laptop için detaylı güç yönetimi — CPU governor, USB autosuspend, SATA link power. power-profiles-daemon'a alternatif (ikisi birden kurulmamalı).",
          cmd: "sudo apt install -y tlp tlp-rdw",
          kind: "apt.install",
          pkgs: ["tlp", "tlp-rdw"],
        }),
        driverCard({
          color: "#ff0099",
          title: "fwupd (firmware güncellemeleri)",
          sub: "LVFS üzerinden BIOS/UEFI, SSD firmware, dock firmware otomatik güncelleme. Donanım üreticisi destekliyorsa altın.",
          cmd: "sudo apt install -y fwupd",
          kind: "apt.install",
          pkgs: ["fwupd"],
        }),
      ].join("");

    case "dnf":
      return [
        driverCard({
          color: "#00f0ff",
          title: "power-profiles-daemon",
          sub: "Fedora'da varsayılan. Yoksa kur. GNOME/KDE güç profili menüsünü etkinleştirir.",
          cmd: "sudo dnf install -y power-profiles-daemon",
          kind: "dnf.install",
          pkgs: ["power-profiles-daemon"],
        }),
        driverCard({
          color: "#ffd400",
          title: "thermald",
          sub: "Intel CPU termal yönetim daemon'u.",
          cmd: "sudo dnf install -y thermald",
          kind: "dnf.install",
          pkgs: ["thermald"],
        }),
        driverCard({
          color: "#b400ff",
          title: "TLP (alternatif)",
          sub: "power-profiles-daemon'a alternatif gelişmiş güç yönetimi. İkisi aynı anda olmamalı.",
          cmd: "sudo dnf install -y tlp tlp-rdw",
          kind: "dnf.install",
          pkgs: ["tlp", "tlp-rdw"],
        }),
        driverCard({
          color: "#ff0099",
          title: "fwupd (firmware güncellemeleri)",
          sub: "Fedora'da default kurulu. Yoksa LVFS üzerinden donanım firmware güncellemeleri.",
          cmd: "sudo dnf install -y fwupd",
          kind: "dnf.install",
          pkgs: ["fwupd"],
        }),
      ].join("");

    case "pacman":
      return [
        driverCard({
          color: "#00f0ff",
          title: "power-profiles-daemon",
          sub: "GNOME/KDE güç profili menüsü için.",
          cmd: "sudo pacman -S --noconfirm power-profiles-daemon",
          kind: "pacman.install",
          pkgs: ["power-profiles-daemon"],
        }),
        driverCard({
          color: "#ffd400",
          title: "thermald",
          sub: "Intel termal yönetim daemon'u.",
          cmd: "sudo pacman -S --noconfirm thermald",
          kind: "pacman.install",
          pkgs: ["thermald"],
        }),
        driverCard({
          color: "#b400ff",
          title: "TLP",
          sub: "Detaylı laptop güç yönetimi (alternatif).",
          cmd: "sudo pacman -S --noconfirm tlp tlp-rdw",
          kind: "pacman.install",
          pkgs: ["tlp", "tlp-rdw"],
        }),
        driverCard({
          color: "#ff0099",
          title: "fwupd",
          sub: "LVFS firmware güncellemeleri.",
          cmd: "sudo pacman -S --noconfirm fwupd",
          kind: "pacman.install",
          pkgs: ["fwupd"],
        }),
      ].join("");

    case "zypper":
      return [
        driverCard({
          color: "#00f0ff",
          title: "power-profiles-daemon",
          sub: "Güç profili menüsü desteği.",
          cmd: "sudo zypper install -y power-profiles-daemon",
          kind: "zypper.install",
          pkgs: ["power-profiles-daemon"],
        }),
        driverCard({
          color: "#ffd400",
          title: "thermald",
          sub: "Intel termal yönetimi.",
          cmd: "sudo zypper install -y thermald",
          kind: "zypper.install",
          pkgs: ["thermald"],
        }),
        driverCard({
          color: "#b400ff",
          title: "TLP",
          sub: "Laptop güç yönetimi.",
          cmd: "sudo zypper install -y tlp tlp-rdw",
          kind: "zypper.install",
          pkgs: ["tlp", "tlp-rdw"],
        }),
        driverCard({
          color: "#ff0099",
          title: "fwupd",
          sub: "Firmware güncellemeleri.",
          cmd: "sudo zypper install -y fwupd",
          kind: "zypper.install",
          pkgs: ["fwupd"],
        }),
      ].join("");

    default:
      return `<div class="muted">Bu distro için güç/termal önerisi yok.</div>`;
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
