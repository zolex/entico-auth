# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Entico Auth: a Windows desktop app (Tauri + Vue 3 + TypeScript) that manages TOTP accounts stored
on a YubiKey's OATH application, styled after Ente Auth. There is no local secret store - every
operation shells out to the user's installed `ykman.exe` CLI, and every code is computed live by
the hardware key. See `README.md` for features.

## Non-goals

HOTP accounts, full OATH reset / bulk PSKC import-export, custom account ordering, light mode,
i18n, an in-app auto-updater, and macOS/Linux builds are intentionally out of scope for now -
Entico Auth targets one job on Windows: a clean live view over your YubiKey's TOTP accounts.

## Commands

```sh
make install       # npm install
make dev           # npm run tauri dev - Vite dev server + Tauri, full app window
make build         # vue-tsc --noEmit && vite build, then a debug tauri build
make release       # full release build (installers/bundles)
make test          # frontend (vitest) + Rust (cargo test)
make test-frontend # npm test (vitest run)
make test-rust     # cd src-tauri && cargo test
make lint          # cd src-tauri && cargo fmt --check && cargo clippy
make clean
```

Single test, frontend (vitest): `npx vitest run src/lib/__tests__/totp-timing.test.ts`
Single test, Rust: `cargo test --manifest-path src-tauri/Cargo.toml classifies_wrong_password`

Frontend tests live next to what they cover, in `__tests__/` directories under
`src/{components,stores,lib}`. Rust tests are inline `#[cfg(test)] mod tests` blocks at the
bottom of the file under test (see `src-tauri/src/ykman/exec.rs`, `path.rs`).

CI (`.github/workflows/ci.yml`) runs `vue-tsc --noEmit` + `npm run test` on Linux, and
`cargo check` + `cargo test` on Windows/macOS/Linux. There is no separate typecheck-only make
target; use `npx vue-tsc --noEmit` directly.

## Architecture

### Backend (`src-tauri/src/`) - thin, typed wrapper around `ykman.exe`

- `commands.rs` - every `#[tauri::command]` handler. Each one builds an argv for a specific
  `ykman` subcommand, runs it via `run_ykman`, and parses the result. Handlers never touch OATH
  secrets themselves beyond passing them through as CLI args.
- `ykman/exec.rs` - `run_ykman(serial, args)`, the only place that actually spawns `ykman.exe`.
  Three things happen here that aren't obvious from a single call site:
  - **Global serialization lock** (`ykman_lock`): the YubiKey's CCID transport only tolerates one
    exclusive session at a time, so *every* `ykman` invocation across the whole app (key-presence
    polling, code refresh, user actions) is serialized through one mutex to avoid "Failed
    connecting to a YubiKey" races.
  - **Orphan reaping**: spawned children's PIDs are tracked in a global set; on app exit,
    `kill_stale_children` (called from `lib.rs`'s `ExitRequested` handler) waits out a grace
    period then force-kills anything still running via `taskkill /T`, since Windows doesn't tie
    child lifetime to the parent.
  - **Debug-vs-release log redaction**: stderr/argv logging is unmasked in debug builds
    (`cfg!(debug_assertions)`) and redacted in release builds (`redact_args` strips `-p`/`-n`
    values and the trailing secret positional on `oath accounts add`/`uri`). This asymmetry is
    intentional - see the comment above `redact_args` - don't "fix" it by masking debug logs.
- `ykman/path.rs` - locates `ykman.exe` (PATH first, then the default Yubico install path).
- `ykman/parse.rs` - turns `ykman` stdout into the typed structs in `ykman/types.rs`. This is the
  layer to extend when a new `ykman` output format needs to be surfaced.
- `presence.rs` - Windows Hello write-confirmation gate; see its own section below. All WinRT
  code lives in an inner `#[cfg(windows)] mod win`, with the two `#[tauri::command]` fns at the
  file's top level staying unconditionally defined (with a trivial `#[cfg(not(windows))]`
  fallback body) so `lib.rs`'s `invoke_handler!` list never needs its own cfg logic - same
  convention as the taskkill/kill split in `ykman/exec.rs`'s `kill_stale_children`. This matters
  because CI's Rust job runs `cargo check`/`cargo test` on a Windows/macOS/Linux matrix even
  though the app only ships for Windows, and the `windows`/`windows-future` crates (declared
  under `[target.'cfg(windows)'.dependencies]` in `Cargo.toml`) aren't present in the dependency
  graph at all off-Windows.
- `settings.rs` - the *only* local persistent state: idle-lock timeout (currently unused - the
  Settings UI field for it is hidden), launch-at-startup, last-active key serial, a custom
  `ykman.exe` path override, window remember/geometry, minimize-to-tray, minimize-on-autostart,
  show-window-on-key-plugin, and require-hello-for-writes. Non-secret by design; stored as JSON
  in Tauri's app-config-dir. Every boolean defaults to `true` in `AppSettings::default()` (idle
  lock stays `None`/off) - the app is meant to come up fully "on" out of the box.
- `tray.rs` / `lib.rs` - system tray (close-to-tray) and app bootstrap. `lib.rs` registers every
  command in `invoke_handler!`, owns the exit-time orphan-reaping sequence described above, and
  its `sync_autostart()` (called from `setup()`) reconciles the OS-level Windows autostart
  registration with `settings.launch_at_startup` on every launch - not just a detected first
  run - so it both registers autostart the first time the app ever runs (new-install default is
  `true`, nothing registered yet) and self-heals any future drift (e.g. a hand-edited
  `settings.json`) on the next launch.

### Frontend (`src/`) - Vue 3 + Pinia, no direct IPC calls outside `lib/ykman-client.ts`

- `lib/ykman-client.ts` - one `invoke()` wrapper per Rust command, 1:1 with `commands.rs`. All
  frontend code goes through this; no component/store calls `invoke()` directly. Every method
  that writes to the YubiKey (`oathAddManual`, `oathAddUri`, `oathRename`, `oathDelete`,
  `oathSetPassword`, `oathClearPassword`, `oathRememberPassword`, `oathForgetPassword`), plus
  `setRequireHelloForWrites` itself, calls `requirePresence()` first - this file is the sole
  choke point for IPC, so wrapping it here is what guarantees every write path is gated. Being
  gated is what stops the write-confirmation setting from being silently turned off by a second
  person, without needing every one of that setting's own call sites to re-implement the check.
- `lib/presence.ts` - `requirePresence()`, called by `ykman-client.ts` above. Reads
  `ykman.getSettings().requireHelloForWrites`; if off, resolves immediately. Otherwise calls the
  `verify_presence` command and throws `PresenceCancelledError` unless the result is `Verified`
  or `Unavailable` (no Hello enrolled → gate skipped, write proceeds ungated). Call sites treat a
  thrown `PresenceCancelledError` as an expected "the user backed out" outcome, not a real error:
  the catch block returns early before setting any error text, so the dialog/sheet just stays
  open with nothing changed - see `AddAccountSheet.vue`'s `submitManual`, `PasswordSettingsSheet.vue`'s
  `save`, and `App.vue`'s `onRenameSubmit`/`onDeleteConfirm`. The one exception is
  `AddAccountSheet.vue`'s `submitManualToAll` (saves to every connected key in a loop), where
  `describeYkmanError` maps the cancellation to a visible `'Cancelled.'` in that flow's existing
  per-key results list, since that's the flow's normal way of reporting any per-key outcome.
- `stores/accounts.ts` - the core polling/refresh state machine:
  - `refresh()` fetches account metadata + codes in parallel and merges by `query`. A touch-only
    account never appears in the codes response at all, so a code revealed by
    `revealTouchCode()` is kept alive locally via `codeExpiresAt` until its own period elapses -
    otherwise the next background `refresh()` would wipe it out immediately.
  - `startAutoRefresh()` doesn't poll on a fixed interval; it computes the soonest TOTP period
    boundary across visible accounts (`totp-timing.ts`) and schedules exactly one `refresh()` for
    that instant, then reschedules. Countdown bars animate off the client clock between
    refreshes, not off polling.
  - Switching keys clears `accounts` synchronously (before the async fetch resolves) so a
    slow-arriving refresh for the *previous* key can never be merged onto the newly selected one.
- `stores/keys.ts` - connected-key polling. Backs off from a fast interval (no key selected) to a
  slow presence-check interval (key active), since every poll also contends for the same
  exclusive CCID session as the accounts refresh loop. On a non-`NotFound` error it deliberately
  leaves `keys`/`activeSerial` untouched - a lock contention blip is not proof the key was
  removed, and clearing `activeSerial` here would break an in-flight action (e.g. a password
  dialog) that depends on it.
- `stores/ui.ts` - session-only state, never persisted: per-key-serial OATH passwords
  (`sessionPasswords`), lock state, toasts, idle-lock timer, and clipboard-clear scheduling
  (timed to the specific code's own remaining validity window, not a fixed delay).
- `lib/totp-timing.ts` - pure boundary/progress math shared by countdown bars and refresh
  scheduling.
- `lib/otpauth.ts`, `lib/qr-decode.ts` - `otpauth://` URI parsing and client-side QR image
  decoding (via `jsqr`) for the two non-manual "add account" paths.
- `lib/icons.ts` - issuer-name → brand icon matching (`simple-icons`), falling back to a
  monogram.

### The password/auth contract (backend and frontend must agree here)

`ykman` prompts interactively on Windows console when an OATH-protected operation gets no `-p`
and nothing is remembered - that prompt reads the console directly, bypasses stdin redirection,
and hangs forever for a GUI-spawned child with no console. Both sides work around this the same
way: the frontend never relies on `ykman oath access remember`'s cache for its own calls; instead
`ui.ts`'s `sessionPasswords` holds the password the user typed for the current unlocked session,
and every authenticated `ykman-client.ts` call passes it explicitly as a `password` argument,
which `commands.rs`'s `with_password()` turns into an explicit `-p` flag. "Remember on this
device" is a separate, additive opt-in the user can also enable, not a substitute for this.

### The Windows Hello presence gate

Once the app is unlocked and a key's OATH password is cached for the session, nothing else stops
a second person at the same unattended, unlocked machine from adding/renaming/deleting accounts
or changing the OATH password. `presence.rs` + `lib/presence.ts` close that gap: every YubiKey
write asks for a fresh Windows Hello check immediately beforehand, with no cached/"recently
verified" window.

- Backend (`presence.rs`, Windows-only code behind `mod win`): `verify_presence` calls
  `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` (not the plain
  `UserConsentVerifier::RequestVerificationAsync` - that only works for UWP apps with a
  `CoreWindow`; called from this classic Win32 app it silently hangs forever instead of
  completing or erroring), passing the main window's `HWND`. The result maps to a
  `PresenceResult` (`Verified` / `Unavailable` / `Denied`): `Canceled`/`RetriesExhausted` →
  `Denied` (write blocked), everything else abnormal (`DeviceNotPresent`,
  `NotConfiguredForUser`, `DisabledByPolicy`, `DeviceBusy`) → `Unavailable` (no usable Hello
  factor right now → gate skipped, write proceeds ungated). A separate `check_hello_availability`
  command (`UserConsentVerifier::CheckAvailabilityAsync`, no window/prompt involved) lets the
  Settings UI grey out the toggle up front, independently of that per-write fallback.
- Frontend: `lib/presence.ts`'s `requirePresence()` (see above) is the gate itself;
  `SettingsDialog.vue` calls `checkHelloAvailability()` alongside its normal settings load to
  disable the toggle and show a note when Hello isn't set up.
- Settings toggle: `requireHelloForWrites` (`AppSettings`, defaults `true`). Turning it *off*
  itself goes through `requirePresence()` (see `setRequireHelloForWrites` above) - otherwise
  disabling the whole protection wouldn't itself require proving presence. Turning it *on*
  doesn't need confirmation, since enabling protection isn't the bypass path.
- Non-goals: no backend/Rust-command-level enforcement (the gate lives entirely in the
  frontend, at the same trust boundary as the existing idle-lock in `ui.ts`) and no change to the
  OATH password contract above - this is a presence UX gate, not a cryptographic strengthening of
  the write operations themselves.

### Versioning

`package.json` and `src-tauri/Cargo.toml` intentionally stay pinned at `0.0.0` - they are not the
version source of truth. `.github/workflows/release.yml` rewrites `Cargo.toml`'s version from the
pushed git tag at build time; dev builds instead show the current git branch name, which
`vite.config.ts` injects at build time as the `__GIT_BRANCH__` global via `git rev-parse
--abbrev-ref HEAD`.

## Working with a real YubiKey

Several `ykman` code paths (OATH add/rename/delete, password set/change/remove, touch-required
codes) can only be meaningfully exercised against real hardware - they are not unit-testable.
When verifying changes against a real connected key, never run destructive operations
(`oath_delete`, `oath_set_password`/`oath_clear_password`) or password changes against the user's
actual production key/accounts; these are irreversible on the device. Rust-side unit tests instead
use captured `ykman` stdout/stderr fixtures (`ykman/exec.rs`, `ykman/parse.rs`), and Vue-side tests
mock `lib/ykman-client.ts` rather than talking to a device.

The same applies to the actual Windows Hello prompt (`presence.rs`'s `win::verify_presence`/
`win::check_hello_availability`): only unit-testable up to the pure `PresenceResult`/bool mapping
functions (`presence::win::tests`, which only compile/run on Windows - see the `presence.rs` note
above), not the real WinRT call, which needs a real enrolled Hello factor and an actual consent
dialog to click through.
