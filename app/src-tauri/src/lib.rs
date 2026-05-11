//! Santral — Linux için kontrol merkezi.
//!
//! Bu crate Tauri uygulamasının çekirdeğini barındırır. Frontend ile köprü
//! kurulan komutlar burada `#[tauri::command]` olarak işaretlenir.

mod action;
mod catalog;
mod distro;
mod hardware;
mod optimization;
mod packages;
mod repo_search;
mod repos;
mod scanner;
mod system;
mod util;

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

#[tauri::command]
fn optimization_scan() -> optimization::OptimizationReport {
    optimization::collect()
}

#[tauri::command]
fn repo_list() -> repos::RepoList {
    repos::collect()
}

#[tauri::command]
fn app_search(query: String) -> repo_search::SearchResults {
    repo_search::search(&query)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_info,
            distro_info,
            system_info,
            hardware_info,
            app_catalog,
            scan_catalog,
            package_overview,
            optimization_scan,
            repo_list,
            app_search,
            action::start_action,
            action::list_tasks,
            action::clear_task,
            action::clear_finished_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("santral: tauri runtime failed");
}
