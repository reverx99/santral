# SANTRAL

> Linux için karanlık çağ güvenlik & optimizasyon merkezi.

Santral; rootkit avı, sistem optimizasyonu, paket cephaneliği (Flatpak / Snap), küratörlü bir uygulama arşivi ve repo yönetimini phonk estetikli tek bir kontrol paneli altında toplamayı amaçlayan bir Linux aracıdır.

**Durum:** pre-alpha — şu an yalnızca tanıtım sitesi yayında, çekirdek CLI üzerinde çalışılıyor.

## Tanıtım sitesi

Bu repo'nun kökünde saf HTML/CSS/JS ile yazılmış statik bir landing var. Build adımı yok, GitHub Pages'e doğrudan deploy edilebilir.

- `index.html` — sayfanın iskeleti
- `assets/styles.css` — phonk / neon tema, glitch animasyonları, scanline / grid floor
- `assets/script.js` — terminal yazıcı, scroll-reveal, kart tilt efekti

### Yerelde önizleme

Klasör içinde tek satırlık bir static server yeterli:

```bash
python3 -m http.server 8000
# veya
npx serve .
```

Sonra `http://localhost:8000` adresini aç.

### GitHub Pages'e yayınlama

Bu bir **project page** olarak yayınlanır; kullanıcının `<user>.github.io` kişisel sitesini etkilemez.

1. Repo **Settings → Pages**
2. **Source:** "Deploy from a branch"
3. **Branch:** `main` / **Folder:** `/ (root)`
4. Save

Yayın adresi: `https://<user>.github.io/santral/`

## Yol haritası

- [x] **Faz 0** — Tanıtım sitesi
- [ ] **Faz 1** — Çekirdek CLI: `santral scan`, `santral optimize`, `santral pkg` (Rust)
- [ ] **Faz 2** — Tauri arayüz: aynı çekirdek üzerinde neon panel
- [ ] **Faz 3** — Uygulama arşivi: distro-bilinçli kurulum + imza doğrulama
- [ ] **Faz 4** — Tarama motoru: YARA, planlı tarama, push bildirimi

## Hedef dağıtımlar

| Aile | Paket yöneticisi |
|---|---|
| Debian / Ubuntu | `apt` |
| Fedora / RHEL | `dnf` |
| Arch / Manjaro | `pacman` |
| openSUSE | `zypper` |

## Lisans

MIT.
