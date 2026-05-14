//! Ortak yardımcılar — özellikle subprocess çağrıları için `timeout(1)`
//! kabuğuyla sarmalanmış güvenli Command builder'ı.
//!
//! Linux coreutils'in `timeout` komutu yanıt vermeyen bir alt sürecin
//! fitlinux'un tamamını kilitlemesini engeller: belirtilen saniye sonra
//! SIGTERM, +2 sn sonra SIGKILL gönderir.

use std::process::Command;

/// Belirtilen programı `timeout -k 2 <secs>` ile sarmalanmış olarak başlatır.
/// LC_ALL=C ortamı da uygulanır — çıktı parse'lemesi locale'den bağımsız olsun.
pub fn timed(prog: &str, secs: u64) -> Command {
    let mut c = Command::new("timeout");
    c.arg("-k").arg("2")
     .arg(format!("{secs}"))
     .arg(prog)
     .env("LC_ALL", "C");
    c
}
