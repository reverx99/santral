# fitlinux

> Windows kullanıcısının tek komut yazmadan Linux'a geçebileceği kontrol merkezi.

**fitlinux** (eski adıyla *Santral*); paket yöneticileri, küratörlü uygulama arşivi, sürücüler (NVIDIA, Intel, Bluetooth, Wi-Fi, ses), repo yönetimi ve sistem bakımını **tek arayüz** altında toplar. Hedef: yeni Linux kullanıcısı tek tık (en fazla iki) ile her şeyi halletsin.

İlham: FitGirl Repack — kişiliği olan, bilgi-yoğun ama temiz, "küçük-hızlı-derli" hissi.

**Durum:** pre-alpha. Çekirdek backend (Tauri 2 + Rust) çalışır durumda; varsayılan UI yeniden yazılıyor (F1+).

## Hedef dağıtımlar

| Aile | Paket yöneticisi |
|---|---|
| Ubuntu / Debian / Mint / Pop!_OS | `apt` |
| Fedora / RHEL / Rocky / AlmaLinux | `dnf` |
| Arch / Manjaro / EndeavourOS / **CachyOS** | `pacman` |
| openSUSE | `zypper` |
| Universal | `flatpak`, `snap` |

## Mimari

```
fitlinux/
├── app/                # Tauri 2 desktop
│   ├── src/
│   │   ├── themes/     # _contract.css + fitlinux.css (varsayılan) + cyberphonk.css (eski)
│   │   ├── pages/      # sayfa-başına bir modül
│   │   └── ...         # core, widgets, settings, palette
│   └── src-tauri/      # Rust backend (allowlist-tabanlı aksiyonlar)
├── web/                # Tanıtım sitesi yedekleri
│   └── themes/cyberphonk/  # eski phonk tasarım, F0'da arşivlendi
└── index.html          # Live GitHub Pages (F0 itibariyle eski tasarım)
```

## Temalar

- **fitlinux** (varsayılan, F1'de tamamlanacak) — soft-dark, lavanta aksan, comfy/chill.
- **cyberphonk** — eski tasarım (neon pembe + phonk).
- _ileride_: `light`, `slate`.

Tema seçici Ayarlar → Tema altında, runtime'da geçişli.

## Yerelde geliştirme

```bash
cd app
npm install
npm run dev               # Vite dev server (browser preview, mock backend)
npm run tauri:dev         # Tauri desktop app (gerçek backend)
```

## Tanıtım sitesi

Repo kökü hâlâ eski phonk tanıtım sitesini barındırıyor (`index.html` + `assets/`). GitHub Pages → `https://<user>.github.io/santral/`. Yeni fitlinux landing'i ayrı fazda gelecek.

## Yol haritası

- [x] **F0** — Yedek + rebrand (santral → fitlinux)
- [ ] **F1** — Tema kontratı + fitlinux varsayılan tema
- [ ] **F2** — IA refactor: 10 → 5 sekme + Ana sayfa (sağlık özeti)
- [ ] **F3** — Onboarding wizard
- [ ] **F4** — Sürücü kapsamı: Bluetooth, Wi-Fi/Eth, ses, mikrokod
- [ ] **F5** — Ek temalar (light, slate)
- [ ] **F6** — Distro matris testi + CachyOS kalibrasyonu
- [ ] **F7** — Yeni tanıtım sitesi

## Lisans

MIT.
