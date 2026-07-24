use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

// Tauri's own focus-changed event is unreliable on Windows across a
// hide()/show() cycle to the tray (the blur event silently stops firing
// after the second show(), see tauri-apps/tauri#13633) - so visibility is
// tracked separately via this explicit event instead of relying on focus
// alone. The frontend gates all ykman polling on both signals together.
pub const VISIBILITY_EVENT: &str = "window-visibility";

pub(crate) fn show_and_focus(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize(); // show() alone doesn't restore a taskbar-minimized window
        let _ = w.show();
        // On Windows, SetForegroundWindow (what set_focus() calls under the hood) is
        // blocked by the OS whenever the caller isn't tied to a real user input event and
        // another window currently holds focus - which is exactly our case here, since
        // this runs from a background async task reacting to a USB event, not a click.
        // It only ever worked for the tray-hidden case because making a previously
        // invisible window visible+focused follows a different path than stealing focus
        // from a window that's already on screen (backgrounded or minimized). Briefly
        // toggling always-on-top forces this window above whatever currently has focus
        // without needing that same permission, and set_focus() then completes the
        // handoff.
        let _ = w.set_always_on_top(true);
        let _ = w.set_always_on_top(false);
        let _ = w.set_focus();
        let _ = app.emit(VISIBILITY_EVENT, true);
    }
}

pub(crate) fn hide_to_tray(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        let _ = app.emit(VISIBILITY_EVENT, false);
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Lock Now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &lock, &quit])?;

    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("default window icon"),
        )
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_and_focus(app),
            "hide" => hide_to_tray(app),
            "lock" => {
                let _ = app.emit("lock-now", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click the tray icon reopens the window, mirroring the
            // "Show" menu item (spec: "tray icon click reopens").
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_and_focus(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
