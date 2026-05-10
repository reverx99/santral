//! Santral — Linux için kontrol merkezi.
//!
//! Bu crate Tauri uygulamasının çekirdeğini barındırır. Frontend ile köprü
//! kurulan komutlar burada `#[tauri::command]` olarak işaretlenir.

mod catalog;
mod distro;
mod hardware;
mod packages;
mod scanner;
mod system;

use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub build: &'static str,
    pub repo: &'static str,
    pub channel: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Santral",
        version: env!("CARGO_PKG_VERSION"),
        build: option_env!("SANTRAL_BUILD").unwrap_or("dev"),
        repo: "https://github.com/reverx99/santral",
        channel: if cfg!(debug_assertions) { "debug" } else { "release" },
    }
}

#[tauri::command]
fn distro_info() -> distro::DistroInfo {
    distro::collect()
}

#[tauri::command]
fn system_info() -> system::SystemInfo {
    system::collect()
}

#[tauri::command]
fn hardware_info() -> hardware::HardwareInfo {
    hardware::collect()
}

#[tauri::command]
fn app_catalog() -> catalog::Catalog {
    catalog::collect()
}

#[tauri::command]
fn scan_catalog() -> scanner::ScanCatalog {
    scanner::collect()
}

#[tauri::command]
fn package_overview() -> packages::PackageOverview {
    packages::collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            distro_info,
            system_info,
            hardware_info,
            app_catalog,
            scan_catalog,
            package_overview,
        ])
        .run(tauri::generate_context!())
        .expect("santral: tauri runtime failed");
}
