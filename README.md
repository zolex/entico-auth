# Entico Auth

A focused Windows desktop app for viewing and managing TOTP accounts stored on a
[YubiKey](https://www.yubico.com/)'s OATH application - styled in the spirit of
[Ente Auth](https://ente.io/auth), built with [Tauri](https://tauri.app/) + Vue 3.

There is no local secret store. Every code is computed live on the hardware key by shelling out
to the official [`ykman`](https://developers.yubico.com/yubikey-manager/) CLI - Entico Auth is a
thin, good-looking window onto whatever is already on your key, nothing more.

## Features

- **Live account grid** - responsive card layout, codes refreshed automatically as each
  account's TOTP period rolls over.
- **Add accounts** three ways - manual entry, pasted `otpauth://` URI, or a QR code image file
  (decoded client-side, no webcam).
- **Touch-required accounts** - "tap to reveal" cards that block on the physical key touch, same
  as `ykman` itself.
- **Rename / delete** accounts directly on the device.
- **OATH password support** - unlock prompt, optional "remember on this device" (delegated to
  the OS keychain via `ykman`), set/change/remove password from the menu.
- **Windows Hello confirmation** - every operation that changes the key's contents (add, rename,
  delete, OATH password changes) asks for a fresh Windows Hello check first, so a second person at
  an unlocked, unattended machine can't slip a change through. Degrades gracefully - and the
  setting greys itself out - on a machine without Hello enrolled, and can be turned off entirely
  in Settings (turning it *off* itself requires a Hello confirmation, so the protection can't be
  silently disabled either).
- **Multi-key support** - switch between multiple connected YubiKeys.
- **System tray** - closes to tray instead of quitting, with a manual lock and quit from the
  tray menu; launches at Windows startup and starts minimized to the tray by default.
- **Search** - quick filter across issuer/account name.
- **Zero local secrets** - the app never stores, caches, or transmits an OATH secret; only
  non-sensitive settings (window/tray behavior, launch-at-startup, the Hello-gate toggle,
  last-used key) persist locally.

## Requirements

- Windows 10/11
- [YubiKey Manager](https://developers.yubico.com/yubikey-manager/Releases/) (`ykman.exe`)
  installed and on your `PATH` (or at its default install location)
- A YubiKey with the OATH application enabled
- Optional: Windows Hello enrolled, for the write-confirmation prompt above (the app works fine
  without it - writes just proceed without the extra confirmation)

## Installation

Download the latest installer (`.msi` or `.exe`) from the
[Releases](https://github.com/zolex/entico-auth/releases) page and run it.

## Development

```sh
make install   # npm install
make dev       # run the app in dev mode (npm run tauri dev)
make build     # type-check + build frontend, then a debug Tauri build
make release   # full release build (installers/bundles)
make test      # frontend (vitest) + Rust (cargo test)
make lint      # cargo fmt --check + cargo clippy
```

### Stack

- **Frontend:** Vue 3 + TypeScript + Pinia, built with Vite.
- **Shell:** Tauri (Rust backend, WebView2 on Windows).
- **YubiKey access:** the Rust backend shells out to the user's installed `ykman.exe` for every
  operation - no OATH/CCID/TOTP logic is reimplemented, and no Rust or JS code ever touches a
  secret directly.

### Project layout

```
src/                  Vue frontend (components, Pinia stores, lib helpers)
src-tauri/src/        Rust backend (Tauri commands, ykman wrapper, tray, settings)
```

## Non-goals

HOTP accounts, full OATH reset / bulk PSKC import-export, custom account ordering, light mode,
i18n, an in-app auto-updater, and macOS/Linux builds are intentionally out of scope for now -
Entico Auth targets one job on Windows: a clean live view over your YubiKey's TOTP accounts.
