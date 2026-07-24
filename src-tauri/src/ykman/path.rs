use super::types::YkmanError;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

const DEFAULT_INSTALL_PATH: &str = r"C:\Program Files\Yubico\YubiKey Manager CLI\ykman.exe";

// User-supplied override, set once at startup from persisted settings and
// updated whenever the user saves/clears a custom path from the UI. Kept as a
// process-wide global (like exec.rs's running_children()) rather than
// threaded through every command, since only the two path-management
// commands ever need to write it while every ykman invocation needs to read it.
fn custom_path() -> &'static RwLock<Option<PathBuf>> {
    static CUSTOM_PATH: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
    CUSTOM_PATH.get_or_init(|| RwLock::new(None))
}

pub fn set_custom_path(path: Option<PathBuf>) {
    *custom_path()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = path;
}

pub fn find_ykman() -> Result<PathBuf, YkmanError> {
    // A user-configured path always wins once set, even if ykman later also
    // becomes reachable via PATH or the default install location - otherwise
    // reinstalling/upgrading ykman elsewhere could silently switch which
    // binary gets used out from under an explicit user choice.
    if let Some(custom) = custom_path()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
    {
        if custom.exists() {
            return Ok(custom);
        }
    }
    if let Ok(path) = which::which("ykman") {
        return Ok(path);
    }
    let default = PathBuf::from(DEFAULT_INSTALL_PATH);
    if default.exists() {
        return Ok(default);
    }
    Err(YkmanError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // custom_path() is process-global state, but cargo test runs tests in the
    // same binary concurrently by default. Any test that reads or writes it
    // must hold this lock for its whole body, or another such test can set/
    // clear it in between this test's own set_custom_path() and find_ykman()
    // calls and produce a spurious result.
    fn custom_path_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn default_install_path_is_the_documented_yubico_path() {
        // This is a regression guard on the literal path string, not a filesystem check -
        // filesystem-dependent behavior is covered by manual verification per the spec's
        // testing approach.
        assert_eq!(
            DEFAULT_INSTALL_PATH,
            r"C:\Program Files\Yubico\YubiKey Manager CLI\ykman.exe"
        );
    }

    #[test]
    fn custom_path_wins_when_set_and_existing() {
        let _guard = custom_path_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let dir = std::env::temp_dir();
        let fake_ykman = dir.join(format!("fake-ykman-{}.exe", std::process::id()));
        std::fs::write(&fake_ykman, b"").unwrap();

        set_custom_path(Some(fake_ykman.clone()));
        let found = find_ykman();

        std::fs::remove_file(&fake_ykman).unwrap();
        set_custom_path(None);

        assert_eq!(found.unwrap(), fake_ykman);
    }

    #[test]
    fn falls_through_when_custom_path_no_longer_exists() {
        let _guard = custom_path_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let missing = PathBuf::from(r"C:\definitely\not\a\real\ykman-path.exe");
        set_custom_path(Some(missing));

        // Falls through to whatever PATH/default-install resolution would
        // have found anyway - we only assert it didn't return the missing
        // custom path, since whether ykman is actually installed on the
        // machine running this test varies.
        let found = find_ykman();
        set_custom_path(None);

        if let Ok(path) = found {
            assert_ne!(
                path,
                PathBuf::from(r"C:\definitely\not\a\real\ykman-path.exe")
            );
        }
    }
}
