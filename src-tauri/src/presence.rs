use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub enum PresenceResult {
    Verified,
    Unavailable,
    Denied,
}

// Everything below is Windows-only (WinRT). The command functions at the
// bottom stay unconditionally defined so `lib.rs`'s invoke_handler! list
// never needs its own cfg logic - same convention as the taskkill/kill
// split in ykman/exec.rs's kill_stale_children. The crate isn't shipped for
// other platforms (see README's non-goals), but CI runs `cargo check`/`cargo
// test` on a Windows/macOS/Linux matrix, and the `windows` crate compiles to
// an empty crate off-Windows, so anything referencing it must stay behind
// #[cfg(windows)].
#[cfg(windows)]
mod win {
    use super::PresenceResult;
    use tauri::Manager;
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    use windows_future::IAsyncOperation;

    // DeviceNotPresent/NotConfiguredForUser/DisabledByPolicy/DeviceBusy all
    // mean there's no usable Hello factor right now, so the gate is skipped
    // and the write proceeds ungated (goal 3) rather than blocking the user
    // on a check that can never succeed on this machine/account.
    fn map_result(result: UserConsentVerificationResult) -> PresenceResult {
        match result {
            UserConsentVerificationResult::Verified => PresenceResult::Verified,
            UserConsentVerificationResult::Canceled
            | UserConsentVerificationResult::RetriesExhausted => PresenceResult::Denied,
            _ => PresenceResult::Unavailable,
        }
    }

    // UserConsentVerifier::RequestVerificationAsync (the plain WinRT entry
    // point) only works for UWP apps with a CoreWindow: called from a
    // classic Win32 app like this one, the returned async operation
    // silently never completes, hanging the caller forever instead of
    // erroring. Win32 apps must go through the interop factory's
    // *ForWindowAsync overload and hand it an explicit HWND so the OS knows
    // which window to anchor the consent prompt to.
    fn request_verification(hwnd: HWND) -> windows::core::Result<UserConsentVerificationResult> {
        let interop: IUserConsentVerifierInterop =
            windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
        let message = HSTRING::from("Confirm to change this YubiKey's contents in Entico Auth");
        let op: IAsyncOperation<UserConsentVerificationResult> =
            unsafe { interop.RequestVerificationForWindowAsync(hwnd, &message)? };
        op.get()
    }

    // Synchronous, blocking WinRT call - must run inside spawn_blocking (see
    // verify_presence below), mirroring run_blocking in commands.rs. This is
    // a parallel, unrelated native call, not a ykman invocation, so it
    // doesn't touch the ykman_lock in ykman/exec.rs.
    //
    // HWND wraps a raw pointer, so it isn't Send and can't be captured
    // directly by the spawn_blocking closure - the caller passes the
    // handle's bare pointer value instead (Send-safe, since it's just an
    // opaque OS identifier that's valid to use from any thread) and it's
    // reconstituted here.
    fn verify_blocking(hwnd_value: isize) -> PresenceResult {
        let hwnd = HWND(hwnd_value as *mut core::ffi::c_void);
        match request_verification(hwnd) {
            Ok(result) => map_result(result),
            Err(_) => PresenceResult::Unavailable,
        }
    }

    fn availability_to_bool(availability: UserConsentVerifierAvailability) -> bool {
        availability == UserConsentVerifierAvailability::Available
    }

    fn check_availability_blocking() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.get())
            .map(availability_to_bool)
            .unwrap_or(false)
    }

    // Lets the settings UI grey out the toggle up front, separately from
    // verify_presence's own Unavailable fallback at write-time (goal 3) -
    // this is a pure status probe with no window/consent prompt involved,
    // so it doesn't need an HWND.
    pub async fn check_hello_availability() -> bool {
        tauri::async_runtime::spawn_blocking(check_availability_blocking)
            .await
            .unwrap_or(false)
    }

    pub async fn verify_presence(app: tauri::AppHandle) -> PresenceResult {
        let Some(window) = app.get_webview_window("main") else {
            return PresenceResult::Unavailable;
        };
        let Ok(hwnd) = window.hwnd() else {
            return PresenceResult::Unavailable;
        };
        let hwnd_value = hwnd.0 as isize;
        tauri::async_runtime::spawn_blocking(move || verify_blocking(hwnd_value))
            .await
            .unwrap_or(PresenceResult::Unavailable)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn verified_maps_to_verified() {
            assert_eq!(
                map_result(UserConsentVerificationResult::Verified),
                PresenceResult::Verified
            );
        }

        #[test]
        fn canceled_maps_to_denied() {
            assert_eq!(
                map_result(UserConsentVerificationResult::Canceled),
                PresenceResult::Denied
            );
        }

        #[test]
        fn retries_exhausted_maps_to_denied() {
            assert_eq!(
                map_result(UserConsentVerificationResult::RetriesExhausted),
                PresenceResult::Denied
            );
        }

        #[test]
        fn device_not_present_maps_to_unavailable() {
            assert_eq!(
                map_result(UserConsentVerificationResult::DeviceNotPresent),
                PresenceResult::Unavailable
            );
        }

        #[test]
        fn not_configured_for_user_maps_to_unavailable() {
            assert_eq!(
                map_result(UserConsentVerificationResult::NotConfiguredForUser),
                PresenceResult::Unavailable
            );
        }

        #[test]
        fn disabled_by_policy_maps_to_unavailable() {
            assert_eq!(
                map_result(UserConsentVerificationResult::DisabledByPolicy),
                PresenceResult::Unavailable
            );
        }

        #[test]
        fn device_busy_maps_to_unavailable() {
            assert_eq!(
                map_result(UserConsentVerificationResult::DeviceBusy),
                PresenceResult::Unavailable
            );
        }

        #[test]
        fn available_maps_to_true() {
            assert!(availability_to_bool(
                UserConsentVerifierAvailability::Available
            ));
        }

        #[test]
        fn device_not_present_availability_maps_to_false() {
            assert!(!availability_to_bool(
                UserConsentVerifierAvailability::DeviceNotPresent
            ));
        }

        #[test]
        fn not_configured_for_user_availability_maps_to_false() {
            assert!(!availability_to_bool(
                UserConsentVerifierAvailability::NotConfiguredForUser
            ));
        }

        #[test]
        fn disabled_by_policy_availability_maps_to_false() {
            assert!(!availability_to_bool(
                UserConsentVerifierAvailability::DisabledByPolicy
            ));
        }

        #[test]
        fn device_busy_availability_maps_to_false() {
            assert!(!availability_to_bool(
                UserConsentVerifierAvailability::DeviceBusy
            ));
        }
    }
}

#[tauri::command]
pub async fn check_hello_availability() -> bool {
    #[cfg(windows)]
    {
        win::check_hello_availability().await
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub async fn verify_presence(app: tauri::AppHandle) -> PresenceResult {
    #[cfg(windows)]
    {
        win::verify_presence(app).await
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        PresenceResult::Unavailable
    }
}
