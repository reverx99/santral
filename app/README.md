# santral — masaüstü uygulaması

Tauri 2 (Rust) + Vite (vanilla JS/HTML/CSS). Phonk estetikli, hafif, tek binary.

**Faz 1 kapsamı (şu an buradayız):**
- ✅ Sistem ekranı — distro, paket yöneticisi, flatpak/snap durumu, çekirdek, oturum, CPU, bellek, swap, diskler
- ✅ Donanım ekranı — GPU, ses, ağ arayüzleri, bluetooth, USB, CPU detay (sanallaştırma, microcode, flag'lar)
- ✅ Hakkında ekranı — sürüm, build, repo, yol haritası
- ⏳ Tarama, Paketler, Uygulamalar, Optimizasyon, Repolar — yer tutucu, sonraki fazlarda

## Geliştirme ortamı kurulumu

### Sistem bağımlılıkları (Linux)

**Debian / Ubuntu:**
```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  build-essential curl wget file pkg-config
```

**Fedora / RHEL:**
```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libsoup3-devel \
  gcc gcc-c++ make
```

**Arch / Manjaro:**
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl wget file \
  libappindicator-gtk3 \
  librsvg
```

**openSUSE:**
```bash
sudo zypper in -y \
  webkit2gtk3-soup2-devel \
  gtk3-devel \
  libappindicator3-1 \
  librsvg-devel \
  libsoup-devel \
  pattern:devel_basis
```

### Rust + Node

```bash
# rust (rustup)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# node 20+ (örn. nvm ile)
nvm install --lts
```

### Çalıştırma

```bash
cd app
npm install
npm run tauri:dev    # geliştirme
npm run tauri:build  # release bundle (deb / rpm / appimage)
```

## Mimari

- `src/`               — frontend (Vite, vanilla JS)
  - `main.js`          — bootstrap, routing
  - `util.js`          — html escape, byte/duration biçimleyiciler, kart helper'ları
  - `pages/sistem.js`  — sistem sayfası
  - `pages/donanim.js` — donanım sayfası
  - `pages/hakkinda.js`— hakkında sayfası
  - `styles.css`       — phonk teması
- `src-tauri/`         — Rust backend
  - `src/lib.rs`       — Tauri runtime, `#[tauri::command]` köprüleri
  - `src/distro.rs`    — `/etc/os-release` parser, paket yöneticisi tespiti, flatpak/snap kontrolü
  - `src/system.rs`    — CPU/bellek/disk/uptime (sysinfo crate)
  - `src/hardware.rs`  — `lspci`, `lsusb`, `bluetoothctl`, `/sys/class/net` ile salt-okunur tarama
  - `tauri.conf.json`  — pencere ayarları, bundle hedefleri
  - `capabilities/`    — Tauri 2 capability/permission tanımları
  - `icons/`           — placeholder ikonlar (sonra değiştirilecek)

## Yetki modeli

Bu faz **salt-okunur** — root yetkisi gerektirmez. Sonraki fazlarda paket
kurulumu ve repo yönetimi için **polkit (pkexec)** ile yetkilendirme planlandı.

## Lisans

MIT.
