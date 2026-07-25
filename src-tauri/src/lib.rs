mod commands;
mod demo;
mod presence;
mod settings;
mod tray;
mod usb_watch;
mod ykman;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

// Grace period for an in-flight ykman child to finish on its own before we
// force-kill it during shutdown.
const YKMAN_SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

// How long to let move/resize events settle before persisting geometry -
// each one fires continuously while the user is dragging, and writing the
// settings file on every single event would mean dozens of disk writes per
// drag.
const WINDOW_BOUNDS_DEBOUNCE: Duration = Duration::from_millis(500);

// Passed to the OS-level autostart entry so the app can tell "launched at
// Windows startup" apart from "launched by the user" - the autostart plugin
// otherwise just runs the same exe with no distinguishing marker.
const AUTOSTART_ARG: &str = "--autostart";

// Applies previously-saved geometry (if remembering is on) before the
// window is shown, so the user never sees it flash at the default
// position/size then jump. The window starts hidden (see tauri.conf.json)
// specifically so this can happen first. When `start_hidden` is set (an
// autostart launch with "minimize on autostart" on), geometry is still
// applied so the window is positioned correctly whenever it's later shown
// from the tray, it's just never actually shown here.
fn restore_window_bounds(
    app: &tauri::AppHandle,
    settings: &settings::AppSettings,
    start_hidden: bool,
) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if settings.remember_window {
        if let Some(bounds) = &settings.window_bounds {
            let _ = window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height));
            let _ = window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y));
        }
    }
    if !start_hidden {
        let _ = window.show();
    }
}

// Reconciles the OS-level autostart registration with the persisted setting.
// Runs on every launch, not just first install, so it's self-healing: a
// fresh install (nothing registered yet, setting defaults to true per
// AppSettings::default) gets registered here, and any future drift between
// the two - e.g. a hand-edited settings.json - quietly repairs itself on
// the next launch instead of leaving the setting lying about what's
// actually registered with Windows.
fn sync_autostart(app: &tauri::AppHandle, settings: &settings::AppSettings) {
    let autostart = app.autolaunch();
    let is_enabled = autostart.is_enabled().unwrap_or(false);
    if settings.launch_at_startup && !is_enabled {
        let _ = autostart.enable();
    } else if !settings.launch_at_startup && is_enabled {
        let _ = autostart.disable();
    }
}

// Redirects the titlebar close button to the tray instead of quitting, when
// "minimize to tray" is on. Re-reads the setting on every close (rather than
// capturing it once at startup) so toggling it in Settings takes effect
// immediately without needing a restart.
fn watch_close_to_tray(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        let tauri::WindowEvent::CloseRequested { api, .. } = event else {
            return;
        };
        if !settings::load(&app_handle).minimize_to_tray {
            return;
        }
        api.prevent_close();
        tray::hide_to_tray(&app_handle);
    });
}

// Persists the window's current geometry, debounced via a generation
// counter: each call bumps the counter and only the last one standing after
// the debounce window actually writes to disk.
fn watch_window_bounds(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let generation = Arc::new(AtomicU64::new(0));
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if !matches!(
            event,
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
        ) {
            return;
        }
        let this_generation = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let generation = generation.clone();
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(WINDOW_BOUNDS_DEBOUNCE);
            if generation.load(Ordering::SeqCst) != this_generation {
                return; // superseded by a later event
            }
            let mut settings = settings::load(&app_handle);
            if !settings.remember_window {
                return;
            }
            let Some(window) = app_handle.get_webview_window("main") else {
                return;
            };
            let (Ok(size), Ok(position)) = (window.outer_size(), window.outer_position()) else {
                return;
            };
            settings.window_bounds = Some(settings::WindowBounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            });
            let _ = settings::save(&app_handle, &settings);
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let exiting = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            tray::setup(app.handle())?;
            let settings = settings::load(app.handle());
            ykman::path::set_custom_path(settings.ykman_path.clone().map(std::path::PathBuf::from));
            sync_autostart(app.handle(), &settings);

            if std::env::args().any(|a| a == "--demo") {
                demo::enter();
            }

            let launched_via_autostart = std::env::args().any(|a| a == AUTOSTART_ARG);
            let start_hidden = launched_via_autostart && settings.minimize_on_autostart;
            restore_window_bounds(app.handle(), &settings, start_hidden);
            watch_window_bounds(app.handle());
            watch_close_to_tray(app.handle());
            usb_watch::setup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_ykman,
            commands::list_keys,
            commands::oath_status,
            commands::oath_unlock,
            commands::oath_list_accounts,
            commands::oath_get_codes,
            commands::oath_get_touch_code,
            commands::oath_add_manual,
            commands::oath_add_uri,
            commands::oath_rename,
            commands::oath_delete,
            commands::oath_set_password,
            commands::oath_clear_password,
            commands::oath_remember_password,
            commands::oath_forget_password,
            commands::key_info,
            commands::get_settings,
            commands::set_launch_at_startup,
            commands::set_remember_window,
            commands::set_minimize_to_tray,
            commands::set_minimize_on_autostart,
            commands::set_show_window_on_key_plugin,
            commands::set_require_hello_for_writes,
            commands::set_ykman_path,
            commands::clear_ykman_path,
            commands::set_key_name,
            commands::enter_demo_mode,
            commands::exit_demo_mode,
            commands::is_demo_mode,
            presence::check_hello_availability,
            presence::verify_presence,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // First time through: hold the exit open, kill any ykman
                // processes still running past the grace period on a
                // background thread, then let the exit proceed for real.
                // The second time through (from the exit() call below) this
                // is skipped so the app actually terminates.
                if !exiting.swap(true, Ordering::SeqCst) {
                    api.prevent_exit();
                    let app_handle = app_handle.clone();
                    std::thread::spawn(move || {
                        ykman::exec::kill_stale_children(YKMAN_SHUTDOWN_GRACE);
                        app_handle.exit(0);
                    });
                }
            }
        });
}
