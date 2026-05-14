// fitlinux — entry point. real work lives in the library crate.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    santral_lib::run();
}
