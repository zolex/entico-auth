// In-process demo mode: simulates ykman.exe entirely in memory, so the app
// can be tried/screenshotted without a real YubiKey or ykman install. The
// only integration point is `run_ykman` in `ykman/exec.rs`, which calls
// `run()` here instead of spawning a subprocess whenever demo mode is
// active - `run()` takes the exact same `(serial, args)` shape `commands.rs`
// already builds for the real CLI and returns plain stdout text, so
// `commands.rs` and `parse.rs` need zero changes and can't tell the
// difference between a real key and a demo one.
use super::ykman::types::YkmanError;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone)]
struct DemoAccount {
    issuer: Option<String>,
    name: String,
    secret: String, // base32
    digits: u8,
    algorithm: String, // "SHA1" | "SHA256"
    period: u32,
    touch_required: bool,
}

impl DemoAccount {
    fn query(&self) -> String {
        match &self.issuer {
            Some(i) => format!("{i}:{}", self.name),
            None => self.name.clone(),
        }
    }
}

struct DemoKey {
    serial: String,
    name: String,
    device_type: String,
    firmware_version: String,
    password: Option<String>,
    remembered: bool,
    accounts: Vec<DemoAccount>,
}

struct DemoState {
    keys: Vec<DemoKey>,
}

fn state() -> &'static Mutex<Option<DemoState>> {
    static STATE: OnceLock<Mutex<Option<DemoState>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

fn active() -> &'static AtomicBool {
    static ACTIVE: OnceLock<AtomicBool> = OnceLock::new();
    ACTIVE.get_or_init(|| AtomicBool::new(false))
}

pub fn is_active() -> bool {
    active().load(Ordering::SeqCst)
}

pub fn enter() {
    *state().lock().unwrap_or_else(|p| p.into_inner()) = Some(seed());
    active().store(true, Ordering::SeqCst);
}

pub fn exit() {
    active().store(false, Ordering::SeqCst);
    *state().lock().unwrap_or_else(|p| p.into_inner()) = None;
}

// Every distinct account that exists anywhere in the demo, defined exactly
// once and referenced by `id` from key_defs() below - the diff (which
// account is on which key) lives entirely in that membership, not in copies
// of account data, so there's nothing for two keys' "same" account to drift
// out of sync with.
struct AccountDef {
    id: &'static str,
    issuer: &'static str,
    name: &'static str,
    secret: &'static str, // base32
    digits: u8,
    algorithm: &'static str, // "SHA1" | "SHA256"
    period: u32,
    touch_required: bool,
}

const fn account_def(
    id: &'static str,
    issuer: &'static str,
    name: &'static str,
    secret: &'static str,
) -> AccountDef {
    AccountDef {
        id,
        issuer,
        name,
        secret,
        digits: 6,
        algorithm: "SHA1",
        period: 30,
        touch_required: false,
    }
}

const ACCOUNTS: &[AccountDef] = &[
    account_def("github", "GitHub", "octocat", "JBSWY3DPEHPK3PXP"),
    account_def("google", "Google", "octocat@gmail.com", "KRSXG5CTMVRXEZLU"),
    account_def(
        "cloudflare",
        "Cloudflare",
        "octocat@company.com",
        "MFRGGZDFMZTWQ2LK",
    ),
    account_def("dropbox", "Dropbox", "octocat", "GEZDGNBVGY3TQOJQ"),
    account_def(
        "stripe",
        "Stripe",
        "octocat@company.com",
        "NBSWY3DPFQQGI3TE",
    ),
    account_def("discord", "Discord", "octocat#1234", "PFYVIZLZOJTHM==="),
    AccountDef {
        digits: 8,
        algorithm: "SHA256",
        ..account_def(
            "proton_mail",
            "Proton Mail",
            "octocat@proton.me",
            "OB4XG5DFNZTWQ2LK",
        )
    },
    account_def(
        "1password",
        "1Password",
        "octocat@company.com",
        "HEZDGYTFPBQXA===",
    ),
    account_def(
        "microsoft",
        "Microsoft",
        "octocat@outlook.com",
        "IFYHK3DBEBWWKZ3M",
    ),
    AccountDef {
        touch_required: true,
        ..account_def("old_service", "Old Service", "legacy", "ONXW2ZLUEBUW4ZY=")
    },
    AccountDef {
        touch_required: true,
        ..account_def("steam", "Steam", "octocat", "JVSWK3TFMFXG65I=")
    },
    AccountDef {
        touch_required: true,
        period: 60,
        ..account_def("kraken", "Kraken", "octocat@gmail.com", "NRSXG5DFMZTWQ2LK")
    },
];

fn resolve(id: &str) -> DemoAccount {
    let def = ACCOUNTS
        .iter()
        .find(|a| a.id == id)
        .unwrap_or_else(|| panic!("no such demo account id: {id}"));
    DemoAccount {
        issuer: Some(def.issuer.to_string()),
        name: def.name.to_string(),
        secret: def.secret.to_string(),
        digits: def.digits,
        algorithm: def.algorithm.to_string(),
        period: def.period,
        touch_required: def.touch_required,
    }
}

// The accounts every key carries, i.e. the actual "database" this demo's
// OATH Diff is built to show off: GitHub/Google sync everywhere (no diff
// card), most of the rest sync to Home and Mobile but were never copied to
// Backup (the common real-world drift of "everything's backed up except the
// actual backup key"), and a few exist on exactly one key.
const SYNCED_EVERYWHERE: &[&str] = &["github", "google"];
const SYNCED_EXCEPT_BACKUP: &[&str] = &[
    "cloudflare",
    "dropbox",
    "stripe",
    "discord",
    "proton_mail",
    "1password",
    "microsoft",
];

struct KeyDef {
    serial: &'static str,
    name: &'static str,
    device_type: &'static str,
    firmware_version: &'static str,
    password: Option<&'static str>,
    remembered: bool,
    account_ids: Vec<&'static str>,
}

// Built from SYNCED_EVERYWHERE/SYNCED_EXCEPT_BACKUP (not spelled out again
// per key) plus each key's own one-off account, so the "missing from Backup
// only" shape is a direct consequence of the membership lists above, not
// something re-typed here that could quietly drift out of sync with them.
fn key_defs() -> Vec<KeyDef> {
    let synced_except_backup: Vec<&'static str> = SYNCED_EVERYWHERE
        .iter()
        .chain(SYNCED_EXCEPT_BACKUP.iter())
        .copied()
        .collect();
    vec![
        KeyDef {
            serial: "36700111",
            name: "Home",
            device_type: "YubiKey 5C NFC",
            firmware_version: "5.7.1",
            password: None,
            remembered: false,
            account_ids: synced_except_backup
                .iter()
                .copied()
                .chain(["old_service"])
                .collect(),
        },
        KeyDef {
            serial: "36700222",
            name: "Mobile",
            device_type: "YubiKey 5 Nano",
            firmware_version: "5.4.3",
            password: Some("demo123"),
            remembered: false,
            account_ids: synced_except_backup
                .iter()
                .copied()
                .chain(["steam"])
                .collect(),
        },
        KeyDef {
            serial: "36700333",
            name: "Backup",
            device_type: "YubiKey Bio - FIDO Edition",
            firmware_version: "5.7.1",
            password: Some("demo456"),
            remembered: true,
            account_ids: SYNCED_EVERYWHERE
                .iter()
                .copied()
                .chain(["kraken"])
                .collect(),
        },
    ]
}

fn seed() -> DemoState {
    DemoState {
        keys: key_defs()
            .into_iter()
            .map(|k| DemoKey {
                serial: k.serial.to_string(),
                name: k.name.to_string(),
                device_type: k.device_type.to_string(),
                firmware_version: k.firmware_version.to_string(),
                password: k.password.map(str::to_string),
                remembered: k.remembered,
                accounts: k.account_ids.iter().map(|id| resolve(id)).collect(),
            })
            .collect(),
    }
}

// Mirrors the auth contract every real oath_* command relies on: a
// password-protected, not-remembered key requires a matching password on
// every call; a remembered key ignores whatever (or no) password was
// passed, same as a real key with `ykman oath access remember` already run.
fn check_password(key: &DemoKey, password: Option<&str>) -> Result<(), YkmanError> {
    match &key.password {
        Some(expected) if !key.remembered => {
            if password == Some(expected.as_str()) {
                Ok(())
            } else {
                Err(YkmanError::WrongPassword)
            }
        }
        _ => Ok(()),
    }
}

fn totp_code(account: &DemoAccount) -> String {
    let secret = base32::decode(base32::Alphabet::Rfc4648 { padding: true }, &account.secret)
        .unwrap_or_default();
    let counter = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / account.period as u64;
    let counter_bytes = counter.to_be_bytes();
    let hash: Vec<u8> = match account.algorithm.as_str() {
        "SHA256" => {
            let mut mac =
                Hmac::<Sha256>::new_from_slice(&secret).expect("HMAC accepts any key length");
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
        _ => {
            let mut mac =
                Hmac::<Sha1>::new_from_slice(&secret).expect("HMAC accepts any key length");
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
    };
    let offset = (hash[hash.len() - 1] & 0xf) as usize;
    let bin = ((hash[offset] as u32 & 0x7f) << 24)
        | ((hash[offset + 1] as u32) << 16)
        | ((hash[offset + 2] as u32) << 8)
        | (hash[offset + 3] as u32);
    let modulus = 10u32.pow(account.digits as u32);
    format!("{:0width$}", bin % modulus, width = account.digits as usize)
}

// How long a touch-required code takes to "resolve" - long enough to see the
// same waiting UI (TouchDialog) a real touch shows while the physical
// sensor is waiting for a finger. Runs on the same blocking worker thread
// `run_blocking` already spawns for every real ykman call, so this needs no
// thread of its own.
const SIMULATED_TOUCH_DELAY: Duration = Duration::from_secs(2);

// Real `ykman` calls never come back instantly - USB/CCID round-trips have
// their own jitter. A fixed delay would make every demo call feel
// identically snappy (and let refresh timing race the UI in ways real
// hardware never lines up), so every call gets a bit of randomized latency
// on top of whatever it does anyway. No `rand` dependency needed for a
// cosmetic jitter this small - the low bits of the system clock are random
// enough.
const SIMULATED_LATENCY_MIN_MS: u64 = 200;
const SIMULATED_LATENCY_JITTER_MS: u64 = 666;

fn simulated_latency() -> Duration {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    Duration::from_millis(SIMULATED_LATENCY_MIN_MS + (nanos as u64 % SIMULATED_LATENCY_JITTER_MS))
}

// Minimal argv scanner for the fixed set of shapes commands.rs builds -
// not a general CLI parser. `value_flags` lists which flags consume the
// following token as their value; everything else starting with `-` is a
// bare boolean flag, and every other token is a positional.
struct ParsedArgs<'a> {
    positionals: Vec<&'a str>,
    flags: HashMap<&'a str, Option<&'a str>>,
}

fn parse_args<'a>(args: &[&'a str], value_flags: &[&str]) -> ParsedArgs<'a> {
    let mut positionals = Vec::new();
    let mut flags = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let a = args[i];
        if a.starts_with('-') {
            if value_flags.contains(&a) {
                flags.insert(a, args.get(i + 1).copied());
                i += 2;
            } else {
                flags.insert(a, None);
                i += 1;
            }
        } else {
            positionals.push(a);
            i += 1;
        }
    }
    ParsedArgs { positionals, flags }
}

fn with_state<T>(f: impl FnOnce(&mut DemoState) -> Result<T, YkmanError>) -> Result<T, YkmanError> {
    let mut guard = state().lock().unwrap_or_else(|p| p.into_inner());
    let demo = guard.as_mut().ok_or(YkmanError::NoKeyConnected)?;
    f(demo)
}

fn find_key<'a>(
    demo: &'a mut DemoState,
    serial: Option<&str>,
) -> Result<&'a mut DemoKey, YkmanError> {
    let serial = serial.ok_or(YkmanError::NoKeyConnected)?;
    demo.keys
        .iter_mut()
        .find(|k| k.serial == serial)
        .ok_or(YkmanError::NoKeyConnected)
}

/// Simulates `ykman.exe` for the given argv, returning the same stdout shape
/// the real binary would (or the same error `classify_error` would produce)
/// for every argv shape `commands.rs` builds.
pub fn run(serial: Option<&str>, args: &[&str]) -> Result<String, YkmanError> {
    if !cfg!(test) {
        sleep(simulated_latency());
    }
    match args {
        ["--version"] => Ok("YubiKey Manager (ykman) version: 5.7.1 (demo mode)\n".to_string()),
        ["list"] => Ok(list_stdout()),
        ["info"] => with_state(|demo| Ok(key_info_stdout(find_key(demo, serial)?))),
        ["oath", "info"] => with_state(|demo| Ok(oath_info_stdout(find_key(demo, serial)?))),
        ["oath", "accounts", "list", rest @ ..] => {
            let parsed = parse_args(rest, &["-p"]);
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, parsed.flags.get("-p").copied().flatten())?;
                Ok(accounts_list_stdout(key))
            })
        }
        ["oath", "accounts", "code", rest @ ..] => {
            let parsed = parse_args(rest, &["-p"]);
            let password = parsed.flags.get("-p").copied().flatten();
            if let Some(&query) = parsed.positionals.first() {
                if !cfg!(test) {
                    sleep(SIMULATED_TOUCH_DELAY);
                }
                with_state(|demo| {
                    let key = find_key(demo, serial)?;
                    check_password(key, password)?;
                    let account = key
                        .accounts
                        .iter()
                        .find(|a| a.query() == query)
                        .ok_or_else(|| YkmanError::Other {
                            message: "No such account".to_string(),
                        })?;
                    Ok(format!("{}\n", totp_code(account)))
                })
            } else {
                with_state(|demo| {
                    let key = find_key(demo, serial)?;
                    check_password(key, password)?;
                    Ok(codes_stdout(key))
                })
            }
        }
        ["oath", "accounts", "add", rest @ ..] => {
            let parsed = parse_args(rest, &["-i", "-d", "-a", "-P", "-p"]);
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, parsed.flags.get("-p").copied().flatten())?;
                let [name, secret] = parsed.positionals[..] else {
                    return Err(YkmanError::Other {
                        message: "malformed demo add-account call".to_string(),
                    });
                };
                let new_account = DemoAccount {
                    issuer: parsed
                        .flags
                        .get("-i")
                        .copied()
                        .flatten()
                        .map(str::to_string),
                    name: name.to_string(),
                    secret: secret.to_string(),
                    digits: parsed
                        .flags
                        .get("-d")
                        .copied()
                        .flatten()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(6),
                    algorithm: parsed
                        .flags
                        .get("-a")
                        .copied()
                        .flatten()
                        .unwrap_or("SHA1")
                        .to_string(),
                    period: parsed
                        .flags
                        .get("-P")
                        .copied()
                        .flatten()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(30),
                    touch_required: parsed.flags.contains_key("-t"),
                };
                let query = new_account.query();
                if key.accounts.iter().any(|a| a.query() == query) {
                    return Err(YkmanError::Other {
                        message: "An account with this name already exists".to_string(),
                    });
                }
                key.accounts.push(new_account);
                Ok(String::new())
            })
        }
        ["oath", "accounts", "uri", rest @ ..] => {
            let parsed = parse_args(rest, &["-p"]);
            let uri = *parsed
                .positionals
                .first()
                .ok_or_else(|| YkmanError::Other {
                    message: "malformed demo uri call".to_string(),
                })?;
            let account = parse_otpauth_uri(uri).ok_or_else(|| YkmanError::Other {
                message: "Invalid otpauth URI".to_string(),
            })?;
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, parsed.flags.get("-p").copied().flatten())?;
                let query = account.query();
                if key.accounts.iter().any(|a| a.query() == query) {
                    return Err(YkmanError::Other {
                        message: "An account with this name already exists".to_string(),
                    });
                }
                key.accounts.push(account);
                Ok(String::new())
            })
        }
        ["oath", "accounts", "rename", rest @ ..] => {
            let parsed = parse_args(rest, &["-p"]);
            let [query, name_arg] = parsed.positionals[..] else {
                return Err(YkmanError::Other {
                    message: "malformed demo rename call".to_string(),
                });
            };
            let (new_issuer, new_name) = match name_arg.split_once(':') {
                Some((i, n)) => (Some(i.to_string()), n.to_string()),
                None => (None, name_arg.to_string()),
            };
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, parsed.flags.get("-p").copied().flatten())?;
                let account = key
                    .accounts
                    .iter_mut()
                    .find(|a| a.query() == query)
                    .ok_or_else(|| YkmanError::Other {
                        message: "No such account".to_string(),
                    })?;
                account.issuer = new_issuer.clone();
                account.name = new_name.clone();
                Ok(String::new())
            })
        }
        ["oath", "accounts", "delete", rest @ ..] => {
            let parsed = parse_args(rest, &["-p"]);
            let query = *parsed
                .positionals
                .first()
                .ok_or_else(|| YkmanError::Other {
                    message: "malformed demo delete call".to_string(),
                })?;
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, parsed.flags.get("-p").copied().flatten())?;
                key.accounts.retain(|a| a.query() != query);
                Ok(String::new())
            })
        }
        ["oath", "access", "change", rest @ ..] => {
            let parsed = parse_args(rest, &["-p", "-n"]);
            let current_password = parsed.flags.get("-p").copied().flatten();
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, current_password)?;
                if parsed.flags.contains_key("-c") {
                    key.password = None;
                    key.remembered = false;
                } else {
                    let new_password =
                        parsed.flags.get("-n").copied().flatten().ok_or_else(|| {
                            YkmanError::Other {
                                message: "malformed demo password-change call".to_string(),
                            }
                        })?;
                    key.password = Some(new_password.to_string());
                    key.remembered = parsed.flags.contains_key("-r");
                }
                Ok(String::new())
            })
        }
        ["oath", "access", "remember", rest @ ..] => {
            let parsed = parse_args(rest, &["-p"]);
            with_state(|demo| {
                let key = find_key(demo, serial)?;
                check_password(key, parsed.flags.get("-p").copied().flatten())?;
                key.remembered = true;
                Ok(String::new())
            })
        }
        ["oath", "access", "forget"] => with_state(|demo| {
            let key = find_key(demo, serial)?;
            key.remembered = false;
            Ok(String::new())
        }),
        _ => Err(YkmanError::Other {
            message: format!("demo mode: unhandled ykman invocation {args:?}"),
        }),
    }
}

fn list_stdout() -> String {
    let guard = state().lock().unwrap_or_else(|p| p.into_inner());
    guard
        .as_ref()
        .map(|demo| {
            demo.keys
                .iter()
                .map(|k| {
                    format!(
                        "{} ({}) [FIDO+CCID] Serial: {}\n",
                        k.name, k.firmware_version, k.serial
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn key_info_stdout(key: &DemoKey) -> String {
    format!(
        "Device type: {}\nSerial number: {}\nFirmware version: {}\nForm factor: Keychain (USB-A)\n",
        key.device_type, key.serial, key.firmware_version
    )
}

fn oath_info_stdout(key: &DemoKey) -> String {
    let mut out = format!(
        "OATH version:        5.7.4\nPassword protection: {}\n",
        if key.password.is_some() {
            "enabled"
        } else {
            "disabled"
        }
    );
    if key.remembered {
        out.push_str("The password for this YubiKey is remembered by ykman.\n");
    }
    out
}

fn accounts_list_stdout(key: &DemoKey) -> String {
    key.accounts
        .iter()
        .map(|a| format!("{}, TOTP, {}\n", a.query(), a.period))
        .collect()
}

fn codes_stdout(key: &DemoKey) -> String {
    key.accounts
        .iter()
        .map(|a| {
            let value = if a.touch_required {
                "[Requires Touch]".to_string()
            } else {
                totp_code(a)
            };
            format!("{}             {}\n", a.query(), value)
        })
        .collect()
}

// Just enough of RFC 6238's otpauth:// URI shape to seed a demo account from
// a real QR/URI import - not a general-purpose otpauth parser (that's
// lib/otpauth.ts's job on the frontend for the real ykman path).
fn parse_otpauth_uri(uri: &str) -> Option<DemoAccount> {
    let rest = uri.strip_prefix("otpauth://totp/")?;
    let (label, query) = rest.split_once('?')?;
    let label = url_decode(label);
    let (mut issuer, name) = match label.split_once(':') {
        Some((i, n)) => (Some(i.trim().to_string()), n.trim().to_string()),
        None => (None, label.trim().to_string()),
    };
    let mut secret = String::new();
    let mut digits = 6u8;
    let mut algorithm = "SHA1".to_string();
    let mut period = 30u32;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=')?;
        let v = url_decode(v);
        match k {
            "secret" => secret = v,
            "issuer" => issuer = Some(v),
            "digits" => digits = v.parse().unwrap_or(6),
            "algorithm" => algorithm = v.to_uppercase(),
            "period" => period = v.parse().unwrap_or(30),
            _ => {}
        }
    }
    if secret.is_empty() {
        return None;
    }
    Some(DemoAccount {
        issuer,
        name,
        secret,
        digits,
        algorithm,
        period,
        touch_required: false,
    })
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 3 <= bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(byte);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // `state()`/`active()` are process-global, and cargo test runs tests in
    // the same binary concurrently by default - same reasoning as
    // `ykman/path.rs`'s `custom_path_test_lock`. Every test here holds this
    // for its whole body.
    fn demo_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn enter_activates_and_exit_clears() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        assert!(is_active());
        exit();
        assert!(!is_active());
    }

    #[test]
    fn list_returns_three_seeded_keys() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let out = run(None, &["list"]).unwrap();
        assert_eq!(out.lines().filter(|l| l.contains("Serial:")).count(), 3);
        exit();
    }

    #[test]
    fn rejects_wrong_password_on_protected_key() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let err = run(
            Some("36700222"),
            &["oath", "accounts", "list", "-p", "wrong"],
        )
        .unwrap_err();
        assert_eq!(err, YkmanError::WrongPassword);
        exit();
    }

    #[test]
    fn accepts_correct_password_on_protected_key() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let out = run(
            Some("36700222"),
            &["oath", "accounts", "list", "-o", "-P", "-p", "demo123"],
        )
        .unwrap();
        assert!(out.contains("GitHub:octocat"));
        exit();
    }

    #[test]
    fn remembered_key_ignores_missing_password() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        // Key C is password-protected but remembered - no -p at all.
        let out = run(Some("36700333"), &["oath", "accounts", "list", "-o", "-P"]).unwrap();
        assert!(out.contains("GitHub:octocat"));
        exit();
    }

    #[test]
    fn touch_required_account_has_no_code_in_list() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let out = run(Some("36700111"), &["oath", "accounts", "code"]).unwrap();
        let line = out
            .lines()
            .find(|l| l.starts_with("Old Service:legacy"))
            .unwrap();
        assert!(line.contains("[Requires Touch]"));
        exit();
    }

    #[test]
    fn single_account_code_is_numeric_and_right_length() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let out = run(
            Some("36700111"),
            &["oath", "accounts", "code", "GitHub:octocat", "-s"],
        )
        .unwrap();
        let code = out.trim();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        exit();
    }

    #[test]
    fn eight_digit_account_produces_eight_digit_code() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let out = run(
            Some("36700111"),
            &[
                "oath",
                "accounts",
                "code",
                "Proton Mail:octocat@proton.me",
                "-s",
            ],
        )
        .unwrap();
        assert_eq!(out.trim().len(), 8);
        exit();
    }

    #[test]
    fn add_rename_delete_round_trip() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        run(
            Some("36700111"),
            &[
                "oath",
                "accounts",
                "add",
                "-i",
                "Acme",
                "-d",
                "6",
                "-a",
                "SHA1",
                "-P",
                "30",
                "-f",
                "user",
                "JBSWY3DPEHPK3PXP",
            ],
        )
        .unwrap();
        let listed = run(Some("36700111"), &["oath", "accounts", "list", "-o", "-P"]).unwrap();
        assert!(listed.contains("Acme:user"));

        run(
            Some("36700111"),
            &[
                "oath",
                "accounts",
                "rename",
                "-f",
                "Acme:user",
                "Acme:renamed",
            ],
        )
        .unwrap();
        let listed = run(Some("36700111"), &["oath", "accounts", "list", "-o", "-P"]).unwrap();
        assert!(listed.contains("Acme:renamed"));
        assert!(!listed.contains("Acme:user"));

        run(
            Some("36700111"),
            &["oath", "accounts", "delete", "-f", "Acme:renamed"],
        )
        .unwrap();
        let listed = run(Some("36700111"), &["oath", "accounts", "list", "-o", "-P"]).unwrap();
        assert!(!listed.contains("Acme:renamed"));
        exit();
    }

    #[test]
    fn set_and_clear_password_round_trip() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        // Key A starts unprotected.
        run(
            Some("36700111"),
            &["oath", "access", "change", "-n", "newpw"],
        )
        .unwrap();
        let err = run(
            Some("36700111"),
            &["oath", "accounts", "list", "-p", "wrong"],
        )
        .unwrap_err();
        assert_eq!(err, YkmanError::WrongPassword);

        run(
            Some("36700111"),
            &["oath", "access", "change", "-p", "newpw", "-c"],
        )
        .unwrap();
        run(Some("36700111"), &["oath", "accounts", "list"]).unwrap();
        exit();
    }

    #[test]
    fn unknown_serial_is_no_key_connected() {
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let err = run(Some("99999999"), &["oath", "info"]).unwrap_err();
        assert_eq!(err, YkmanError::NoKeyConnected);
        exit();
    }

    fn account_ids_for(name: &str) -> HashSet<&'static str> {
        key_defs()
            .into_iter()
            .find(|k| k.name == name)
            .unwrap()
            .account_ids
            .into_iter()
            .collect()
    }

    #[test]
    fn seed_diff_shape_matches_design() {
        // Purely structural - straight off the membership tables, no magic
        // strings, no need to even enter demo mode for this half.
        let home = account_ids_for("Home");
        let mobile = account_ids_for("Mobile");
        let backup = account_ids_for("Backup");

        for id in SYNCED_EVERYWHERE {
            assert!(home.contains(id) && mobile.contains(id) && backup.contains(id));
        }
        for id in SYNCED_EXCEPT_BACKUP {
            assert!(home.contains(id) && mobile.contains(id) && !backup.contains(id));
        }
        assert_eq!(SYNCED_EXCEPT_BACKUP.len(), 7);

        let all_ids: HashSet<&str> = home
            .iter()
            .chain(mobile.iter())
            .chain(backup.iter())
            .copied()
            .collect();
        let present_on_exactly_one = all_ids
            .iter()
            .filter(|id| {
                [&home, &mobile, &backup]
                    .iter()
                    .filter(|set| set.contains(**id))
                    .count()
                    == 1
            })
            .count();
        assert_eq!(present_on_exactly_one, 3);

        // Resolution check: the demo backend's real argv path actually
        // surfaces this exact membership, not just the table itself.
        let _guard = demo_test_lock().lock().unwrap_or_else(|p| p.into_inner());
        enter();
        let expected: HashSet<String> = home.iter().map(|id| resolve(id).query()).collect();
        let actual: HashSet<String> =
            run(Some("36700111"), &["oath", "accounts", "list", "-o", "-P"])
                .unwrap()
                .lines()
                .map(|l| l.split(',').next().unwrap().to_string())
                .collect();
        assert_eq!(actual, expected);
        exit();
    }
}
