use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub idle_lock_minutes: Option<u32>,
    pub launch_at_startup: bool,
    pub last_active_serial: Option<String>,
    pub ykman_path: Option<String>,
    pub remember_window: bool,
    pub window_bounds: Option<WindowBounds>,
    pub minimize_to_tray: bool,
    pub minimize_on_autostart: bool,
    pub show_window_on_key_plugin: bool,
    pub require_hello_for_writes: bool,
    // Missing from any settings.json saved before this field existed - #[serde(default)]
    // so those files still parse instead of falling back to AppSettings::default() wholesale.
    #[serde(default)]
    pub key_names: HashMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            idle_lock_minutes: None,
            launch_at_startup: true,
            last_active_serial: None,
            ykman_path: None,
            remember_window: true,
            window_bounds: None,
            minimize_to_tray: true,
            minimize_on_autostart: true,
            show_window_on_key_plugin: true,
            require_hello_for_writes: true,
            key_names: HashMap::new(),
        }
    }
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &tauri::AppHandle) -> AppSettings {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_have_no_idle_lock_but_enable_everything_else() {
        let s = AppSettings::default();
        assert_eq!(s.idle_lock_minutes, None);
        assert!(s.launch_at_startup);
        assert!(s.remember_window);
        assert!(s.minimize_to_tray);
        assert!(s.minimize_on_autostart);
        assert!(s.show_window_on_key_plugin);
        assert!(s.require_hello_for_writes);
    }

    #[test]
    fn round_trips_through_json() {
        let s = AppSettings {
            idle_lock_minutes: Some(5),
            launch_at_startup: true,
            last_active_serial: Some("123".into()),
            ykman_path: Some(r"C:\custom\ykman.exe".into()),
            remember_window: true,
            window_bounds: Some(WindowBounds {
                x: 10,
                y: 20,
                width: 900,
                height: 650,
            }),
            minimize_to_tray: true,
            minimize_on_autostart: true,
            show_window_on_key_plugin: true,
            require_hello_for_writes: true,
            key_names: HashMap::from([("36705123".to_string(), "Work Key".to_string())]),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn parses_settings_json_saved_before_key_names_existed() {
        let json = r#"{
            "idleLockMinutes": null,
            "launchAtStartup": true,
            "lastActiveSerial": null,
            "ykmanPath": null,
            "rememberWindow": true,
            "windowBounds": null,
            "minimizeToTray": true,
            "minimizeOnAutostart": true,
            "showWindowOnKeyPlugin": true,
            "requireHelloForWrites": true
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.key_names, HashMap::new());
    }
}
