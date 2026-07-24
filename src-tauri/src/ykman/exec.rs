use super::path::find_ykman;
use super::types::YkmanError;
use std::collections::HashSet;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// PIDs of ykman children currently in flight, so a shutdown can wait for them
// to finish on their own and only force-kill whatever's left. Windows doesn't
// tie child process lifetime to the parent's, so an ykman invocation that's
// still blocked on the USB device when the app exits would otherwise linger
// as an orphaned process indefinitely.
fn running_children() -> &'static Mutex<HashSet<u32>> {
    static CHILDREN: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
    CHILDREN.get_or_init(|| Mutex::new(HashSet::new()))
}

struct ChildGuard(u32);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        running_children()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.0);
    }
}

/// Waits up to `grace` for any in-flight ykman children to finish on their
/// own, then force-kills whatever is still running. Call this while shutting
/// down so a slow/stuck ykman invocation doesn't outlive the app.
pub fn kill_stale_children(grace: Duration) {
    let deadline = Instant::now() + grace;
    loop {
        if running_children()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty()
        {
            return;
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let stale: Vec<u32> = running_children()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .copied()
        .collect();
    for pid in stale {
        eprintln!("[ykman] force-killing stale process {pid} after shutdown grace period");
        #[cfg(windows)]
        {
            let mut kill = Command::new("taskkill");
            kill.args(["/PID", &pid.to_string(), "/F", "/T"]);
            use std::os::windows::process::CommandExt;
            kill.creation_flags(CREATE_NO_WINDOW);
            let _ = kill.output();
        }
        #[cfg(not(windows))]
        {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
    }
}

// ykman shells out to a real USB/CCID device. The device only tolerates one
// exclusive session at a time, so two `ykman` processes launched at once
// (e.g. the key-polling loop and an OATH status check firing together at
// startup) can race and one comes back with "Failed connecting to a
// YubiKey" even though the key is present and healthy. Serializing every
// invocation through this lock turns that race into a queue.
fn ykman_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

// Passwords and TOTP secrets travel to `ykman` as plain CLI arguments (there's
// no stdin-prompt path wired up). In release builds the echoed command line
// redacts them before it ever reaches the terminal, since printing a real
// OATH password or account seed to a console would undercut this app's whole
// zero-local-secret-storage premise. In debug builds we print the real values
// unredacted instead - a prior incident set a password on the physical
// YubiKey that the user never typed, and the masked log made it impossible to
// tell what ykman was actually invoked with while diagnosing it.
fn redact_args(args: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(args.len());
    let mut redact_next = false;
    for a in args {
        if redact_next {
            out.push("***".to_string());
            redact_next = false;
            continue;
        }
        out.push((*a).to_string());
        if *a == "-p" || *a == "-n" {
            redact_next = true;
        }
    }
    // `oath accounts add <flags…> -f NAME SECRET` and `oath accounts uri -f URI`
    // carry their secret as a trailing positional argument rather than behind a
    // flag, so redact the last argument for those two subcommands specifically.
    if args.len() >= 3 && args[0] == "oath" && args[1] == "accounts" {
        if args[2] == "add" {
            if let Some(last) = out.last_mut() {
                *last = "***".to_string();
            }
        } else if args[2] == "uri" {
            if let Some(last) = out.last_mut() {
                *last = "<otpauth uri redacted>".to_string();
            }
        }
    }
    out
}

fn logged_args(args: &[&str]) -> Vec<String> {
    if cfg!(debug_assertions) {
        args.iter().map(|a| (*a).to_string()).collect()
    } else {
        redact_args(args)
    }
}

pub fn run_ykman(serial: Option<&str>, args: &[&str]) -> Result<String, YkmanError> {
    let exe = find_ykman()?;
    run_at(&exe, serial, args)
}

/// Runs a specific ykman binary directly, bypassing `find_ykman()`'s
/// PATH/default-install/custom-path resolution. Used by `run_ykman` for
/// normal operation, and directly by the "verify a candidate path" flow when
/// the user is picking a new custom path and there's nothing to resolve yet -
/// the path they typed/browsed to *is* the candidate under test.
pub fn run_at(
    exe: &std::path::Path,
    serial: Option<&str>,
    args: &[&str],
) -> Result<String, YkmanError> {
    let _guard = ykman_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    eprintln!(
        "[ykman] {}{} {}",
        exe.display(),
        serial.map(|s| format!(" -d {s}")).unwrap_or_default(),
        logged_args(args).join(" "),
    );
    let mut cmd = Command::new(exe);
    if let Some(s) = serial {
        cmd.arg("-d").arg(s);
    }
    cmd.args(args);
    // Some oath subcommands fall back to an interactive password prompt when
    // no `-p` is given and none is remembered. On Windows that prompt reads
    // straight from the console (bypassing stdin redirection entirely), so a
    // GUI-spawned ykman with no console of its own has nothing to read from
    // and hangs forever instead of failing - this denies it a console to
    // read from so that prompt fails immediately instead.
    cmd.stdin(Stdio::null());
    // .spawn() defaults to inheriting stdout/stderr (unlike .output(), which
    // pipes them automatically) - without this, wait_with_output() below
    // would return empty output and every caller would parse it as "nothing".
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| YkmanError::Other {
        message: e.to_string(),
    })?;
    let pid = child.id();
    running_children()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(pid);
    let _guard = ChildGuard(pid);

    let output = child.wait_with_output().map_err(|e| YkmanError::Other {
        message: e.to_string(),
    })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(classify_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

fn classify_error(stderr: &str) -> YkmanError {
    let lower = stderr.to_lowercase();
    if lower.contains("no yubikey") || lower.contains("failed connecting") {
        YkmanError::NoKeyConnected
    } else if lower.contains("wrong password") || lower.contains("authentication") {
        YkmanError::WrongPassword
    } else if lower.contains("oath") && lower.contains("disabled") {
        YkmanError::OathDisabled
    } else {
        YkmanError::Other {
            message: stderr.trim().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_no_key_connected() {
        assert_eq!(
            classify_error("Failed connecting to a YubiKey."),
            YkmanError::NoKeyConnected
        );
    }

    #[test]
    fn classifies_wrong_password() {
        assert_eq!(
            classify_error("Error: Wrong password."),
            YkmanError::WrongPassword
        );
    }

    #[test]
    fn classifies_oath_disabled() {
        assert_eq!(
            classify_error("Error: OATH application is disabled."),
            YkmanError::OathDisabled
        );
    }

    #[test]
    fn falls_back_to_other() {
        assert_eq!(
            classify_error("Some unexpected message"),
            YkmanError::Other {
                message: "Some unexpected message".to_string()
            }
        );
    }

    #[test]
    fn redact_args_redacts_password_flag() {
        let args = ["oath", "accounts", "list", "-p", "hunter2"];
        assert_eq!(
            redact_args(&args),
            vec!["oath", "accounts", "list", "-p", "***"]
        );
    }

    #[test]
    fn redact_args_redacts_new_password_flag() {
        let args = ["oath", "access", "change", "-p", "old-pw", "-n", "new-pw"];
        assert_eq!(
            redact_args(&args),
            vec!["oath", "access", "change", "-p", "***", "-n", "***"]
        );
    }

    #[test]
    fn redact_args_redacts_trailing_secret_on_add() {
        let args = [
            "oath",
            "accounts",
            "add",
            "-d",
            "6",
            "-f",
            "Service:user",
            "JBSWY3DPEHPK3PXP",
        ];
        let logged = redact_args(&args);
        assert_eq!(logged.last().unwrap(), "***");
        assert_eq!(
            logged[0..7],
            ["oath", "accounts", "add", "-d", "6", "-f", "Service:user"]
        );
    }

    #[test]
    fn redact_args_redacts_uri() {
        let args = [
            "oath",
            "accounts",
            "uri",
            "-f",
            "otpauth://totp/Service:user?secret=ABC",
        ];
        let logged = redact_args(&args);
        assert_eq!(logged.last().unwrap(), "<otpauth uri redacted>");
    }

    #[test]
    fn redact_args_leaves_unrelated_commands_untouched() {
        let args = ["oath", "accounts", "code"];
        assert_eq!(redact_args(&args), vec!["oath", "accounts", "code"]);
    }

    // `cargo test` builds with debug_assertions on, same as `tauri dev`, so
    // this exercises the actual dev-mode code path: real secrets pass through
    // unmasked so they're visible while debugging.
    #[test]
    fn logged_args_does_not_redact_in_debug_builds() {
        let args = ["oath", "accounts", "list", "-p", "hunter2"];
        assert_eq!(
            logged_args(&args),
            vec!["oath", "accounts", "list", "-p", "hunter2"]
        );
    }
}
