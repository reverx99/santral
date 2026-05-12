# santral — masaüstü uygulaması

Tauri 2 (Rust) + Vite (vanilla JS/HTML/CSS). Phonk estetikli, hafif, tek binary.

**Mevcut durum — tüm bölümler dolu ve aksiyon altyapısı tam çalışır:**
- ✅ **Sistem** — distro, paket yöneticisi, flatpak/snap, çekirdek, CPU/RAM/swap/disk, systemd servisleri, locale, açılış süresi analizi, top süreçler, **güncelleme tarama + tek-tık yükseltme**
- ✅ **Donanım** — GPU, ses, ağ (rx/tx/hız), bluetooth, USB, CPU detay, **batarya** (sağlık%), **termal sensörler**, **Secure Boot**, **monitorler**, **SSD/HDD SMART**
- ✅ **Uygulamalar** — 35 küratörlü uygulama, **çoklu-kaynak picker** (DNF + Flatpak + Snap), **canlı repo arama**, **toplu seçim + tek-tık kurulum**, **kaldırma**
- ✅ **Tarama** — 8 güvenlik tarayıcısı (chkrootkit, rkhunter, ClamAV, vb.), **gerçek çalıştırma + sonuç parse** (drawer'da tehdit/uyarı sayısı)
- ✅ **Paketler** — native + flatpak + snap durumu, öneriler, **Flathub tek-tık ekle**
- ✅ **Optimizasyon** — 7 kategori tarama, **gerçek temizlik** (apt-clean, journal vacuum, autoremove, flatpak unused), **toplu güvenli temizlik**
- ✅ **Repolar** — apt/dnf/pacman/zypper depoları + flatpak remotes, **enable/disable/kaldır** (apt için file rename, dnf/zypper için resmi config-manager), **+ Yeni repo ekle** (PPA / DNF URL / Zypper URL / Flatpak remote)
- ✅ **Ayarlar** — tema, otomatik yenileme, **dry-run güvenlik switch'i**, telemetri yok
- ✅ **Hakkında** — sürüm, build, repo, yol haritası

**Aksiyon altyapısı:**
- 60+ allowlist'li action kind (apt/dnf/pacman/zypper/flatpak/snap × install/remove/upgrade/clean/autoremove + repo mgmt + scanner runner + journal vacuum)
- pkexec ile root komutları, polkit cache'i sayesinde oturum başına bir parola
- Native paket yöneticisi tek-anda-bir-iş kilidi
- SIGTERM iptal, kalıcı history (~/.local/share/santral/history.jsonl)
- Dry-run varsayılan AÇIK — Ayarlar'dan kapatılır

### Polkit cache (önerilen)

Pkexec'in varsayılan policy'si `auth_admin_keep` ile parolayı oturum boyu
(genelde 5 dk) tutar. Birden fazla aksiyonu peş peşe çalıştırırken tek
parola yeterli olmasını istiyorsan:

```bash
sudo install -m 644 packaging/org.santral.Santral.policy /usr/share/polkit-1/actions/
```

Daha uzun cache için `/etc/polkit-1/rules.d/49-santral.rules`'a `AUTH_ADMIN_KEEP`
ekleyebilirsin (örnek policy dosyasında yorum satırında).

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
