use crate::settings::{load, save, AppSettings};
use crate::ykman::exec::{run_at, run_ykman};
use crate::ykman::parse::{
    parse_accounts_list, parse_codes, parse_key_info, parse_list, parse_oath_status,
};
use crate::ykman::path::set_custom_path;
use crate::ykman::types::{
    KeyDetails, OathAccount, OathCodeEntry, OathStatus, YkmanError, YubiKeyInfo,
};
use std::path::PathBuf;
use tauri_plugin_autostart::ManagerExt;

async fn run_blocking<F, T>(f: F) -> Result<T, YkmanError>
where
    F: FnOnce() -> Result<T, YkmanError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| YkmanError::Other {
            message: e.to_string(),
        })?
}

#[tauri::command]
pub async fn check_ykman() -> Result<String, YkmanError> {
    run_blocking(|| run_ykman(None, &["--version"])).await
}

#[tauri::command]
pub async fn list_keys() -> Result<Vec<YubiKeyInfo>, YkmanError> {
    run_blocking(|| {
        let out = run_ykman(None, &["list"])?;
        Ok(parse_list(&out))
    })
    .await
}

#[tauri::command]
pub async fn oath_status(serial: String) -> Result<OathStatus, YkmanError> {
    run_blocking(move || {
        let out = run_ykman(Some(&serial), &["oath", "info"])?;
        Ok(parse_oath_status(&out))
    })
    .await
}

#[tauri::command]
pub async fn oath_unlock(
    serial: String,
    password: String,
    remember: bool,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        // A cheap, side-effect-free OATH call validates the password.
        run_ykman(
            Some(&serial),
            &["oath", "accounts", "list", "-p", &password],
        )?;
        if remember {
            run_ykman(
                Some(&serial),
                &["oath", "access", "remember", "-p", &password],
            )?;
        }
        Ok(())
    })
    .await
}

// Every oath subcommand below that touches account data requires
// authentication once the OATH application is password protected. Passing no
// `-p` and relying on ykman's own remembered-password cache is only safe when
// that cache is actually populated (the user explicitly checked "remember");
// otherwise ykman falls back to an interactive console password prompt that
// hangs forever (it reads the console directly on Windows, bypassing stdin
// redirection). So the frontend holds the password the user just typed for
// the unlocked session and passes it through explicitly here every time,
// rather than depending on ykman's cache for the app's own operation.
fn with_password(mut args: Vec<String>, password: Option<&str>) -> Vec<String> {
    if let Some(p) = password {
        args.push("-p".into());
        args.push(p.to_string());
    }
    args
}

#[tauri::command]
pub async fn oath_list_accounts(
    serial: String,
    password: Option<String>,
) -> Result<Vec<OathAccount>, YkmanError> {
    run_blocking(move || {
        let args = with_password(
            vec![
                "oath".into(),
                "accounts".into(),
                "list".into(),
                "-o".into(),
                "-P".into(),
            ],
            password.as_deref(),
        );
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run_ykman(Some(&serial), &arg_refs)?;
        Ok(parse_accounts_list(&out))
    })
    .await
}

#[tauri::command]
pub async fn oath_get_codes(
    serial: String,
    password: Option<String>,
) -> Result<Vec<OathCodeEntry>, YkmanError> {
    run_blocking(move || {
        let args = with_password(
            vec!["oath".into(), "accounts".into(), "code".into()],
            password.as_deref(),
        );
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run_ykman(Some(&serial), &arg_refs)?;
        Ok(parse_codes(&out))
    })
    .await
}

#[tauri::command]
pub async fn oath_get_touch_code(
    serial: String,
    query: String,
    password: Option<String>,
) -> Result<String, YkmanError> {
    run_blocking(move || {
        let args = with_password(
            vec![
                "oath".into(),
                "accounts".into(),
                "code".into(),
                query,
                "-s".into(),
            ],
            password.as_deref(),
        );
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run_ykman(Some(&serial), &arg_refs)?;
        let code = out.trim().to_string();
        if code.is_empty() {
            Err(YkmanError::Other {
                message: "empty response from ykman".to_string(),
            })
        } else {
            Ok(code)
        }
    })
    .await
}

#[tauri::command]
pub async fn oath_add_manual(
    serial: String,
    issuer: Option<String>,
    name: String,
    secret: String,
    digits: u8,
    algorithm: String,
    period: u32,
    touch_required: bool,
    password: Option<String>,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        let mut args: Vec<String> = vec!["oath".into(), "accounts".into(), "add".into()];
        if let Some(i) = &issuer {
            args.push("-i".into());
            args.push(i.clone());
        }
        args.push("-d".into());
        args.push(digits.to_string());
        args.push("-a".into());
        args.push(algorithm.clone());
        args.push("-P".into());
        args.push(period.to_string());
        if touch_required {
            args.push("-t".into());
        }
        args.push("-f".into());
        args.push(name.clone());
        args.push(secret.clone());
        let args = with_password(args, password.as_deref());
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_ykman(Some(&serial), &arg_refs)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_add_uri(
    serial: String,
    uri: String,
    password: Option<String>,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        let args = with_password(
            vec![
                "oath".into(),
                "accounts".into(),
                "uri".into(),
                "-f".into(),
                uri,
            ],
            password.as_deref(),
        );
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_ykman(Some(&serial), &arg_refs)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_rename(
    serial: String,
    query: String,
    new_issuer: Option<String>,
    new_name: String,
    password: Option<String>,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        let name_arg = match &new_issuer {
            Some(i) => format!("{}:{}", i, new_name),
            None => new_name.clone(),
        };
        let args = with_password(
            vec![
                "oath".into(),
                "accounts".into(),
                "rename".into(),
                "-f".into(),
                query,
                name_arg,
            ],
            password.as_deref(),
        );
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_ykman(Some(&serial), &arg_refs)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_delete(
    serial: String,
    query: String,
    password: Option<String>,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        let args = with_password(
            vec![
                "oath".into(),
                "accounts".into(),
                "delete".into(),
                "-f".into(),
                query,
            ],
            password.as_deref(),
        );
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_ykman(Some(&serial), &arg_refs)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_set_password(
    serial: String,
    current_password: Option<String>,
    new_password: String,
    remember: bool,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        let mut args: Vec<String> = vec!["oath".into(), "access".into(), "change".into()];
        if let Some(p) = &current_password {
            args.push("-p".into());
            args.push(p.clone());
        }
        args.push("-n".into());
        args.push(new_password);
        if remember {
            args.push("-r".into());
        }
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_ykman(Some(&serial), &arg_refs)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_clear_password(
    serial: String,
    current_password: String,
) -> Result<(), YkmanError> {
    run_blocking(move || {
        run_ykman(
            Some(&serial),
            &["oath", "access", "change", "-p", &current_password, "-c"],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_remember_password(serial: String, password: String) -> Result<(), YkmanError> {
    run_blocking(move || {
        run_ykman(
            Some(&serial),
            &["oath", "access", "remember", "-p", &password],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn oath_forget_password(serial: String) -> Result<(), YkmanError> {
    run_blocking(move || {
        run_ykman(Some(&serial), &["oath", "access", "forget"])?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn key_info(serial: String) -> Result<KeyDetails, YkmanError> {
    run_blocking(move || {
        let out = run_ykman(Some(&serial), &["info"])?;
        Ok(parse_key_info(serial.clone(), &out))
    })
    .await
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> AppSettings {
    load(&app)
}

#[tauri::command]
pub fn set_launch_at_startup(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load(&app);
    settings.launch_at_startup = enabled;
    save(&app, &settings)?;
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn set_remember_window(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load(&app);
    settings.remember_window = enabled;
    // Drop any previously remembered geometry so re-enabling later doesn't
    // snap back to a stale position (e.g. a monitor that's since been
    // unplugged) instead of starting fresh.
    if !enabled {
        settings.window_bounds = None;
    }
    save(&app, &settings)
}

#[tauri::command]
pub fn set_minimize_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load(&app);
    settings.minimize_to_tray = enabled;
    save(&app, &settings)
}

#[tauri::command]
pub fn set_minimize_on_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load(&app);
    settings.minimize_on_autostart = enabled;
    save(&app, &settings)
}

#[tauri::command]
pub fn set_show_window_on_key_plugin(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load(&app);
    settings.show_window_on_key_plugin = enabled;
    save(&app, &settings)
}

#[tauri::command]
pub fn set_require_hello_for_writes(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load(&app);
    settings.require_hello_for_writes = enabled;
    save(&app, &settings)
}

#[tauri::command]
pub async fn set_ykman_path(app: tauri::AppHandle, path: String) -> Result<(), YkmanError> {
    let candidate = PathBuf::from(&path);
    if !candidate.is_file() {
        return Err(YkmanError::Other {
            message: "That file doesn't exist.".to_string(),
        });
    }
    // Confirm the candidate is actually usable as ykman (not just any .exe)
    // before persisting it - a wrong binary saved here would otherwise only
    // surface later as a confusing failure on some unrelated action.
    run_blocking({
        let candidate = candidate.clone();
        move || run_at(&candidate, None, &["--version"])
    })
    .await?;

    let mut settings = load(&app);
    settings.ykman_path = Some(path);
    save(&app, &settings).map_err(|message| YkmanError::Other { message })?;
    set_custom_path(Some(candidate));
    Ok(())
}

#[tauri::command]
pub fn clear_ykman_path(app: tauri::AppHandle) -> Result<(), String> {
    let mut settings = load(&app);
    settings.ykman_path = None;
    save(&app, &settings)?;
    set_custom_path(None);
    Ok(())
}
