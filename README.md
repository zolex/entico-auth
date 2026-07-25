# Entico Auth

[![CI](https://github.com/zolex/entico-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/zolex/entico-auth/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zolex/entico-auth)](https://github.com/zolex/entico-auth/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](#requirements)
[![License](https://img.shields.io/github/license/zolex/entico-auth)](LICENSE)

<img src="entico-auth.png" alt="Demo mode, second screenshot" align="right" width="120" hspace="20" vspace="0" />

A focused Windows desktop app for viewing and managing TOTP accounts stored on a
[YubiKey](https://www.yubico.com/)'s OATH application - styled in the spirit of
[Ente Auth](https://ente.io/auth), built with [Tauri](https://tauri.app/) + Vue 3.

There is no local secret store. Every code is computed live on the hardware key by shelling out
to the official [`ykman`](https://developers.yubico.com/yubikey-manager/) CLI - Entico Auth is a
thin, good-looking window onto whatever is already on your key, nothing more.

## Features

Entico Auth is an authenticator app that works with Yubico YubiKey's OATH application, but with
the look and feel of [Ente Auth](https://ente.io/auth): A clean account grid instead of the
official [Yubico Authenticator](https://www.yubico.com/products/yubico-authenticator/)'s
utilitarian list with several clicks required to create and copy a TOTP.

Key features beyond the user experience:
- **Add an account to every connected key at once**, instead of repeating manual entry per key.
- **Import a QR-Code** from the disk to add a new account
- **A diff view across connected keys**: See at a glance which accounts are missing or out of sync
between two keys
- Optional **Windows Hello protection** on every write (add, rename, delete, OATH password changes),
so a second person at an unlocked, unattended machine can't slip a change through, even if ykman is
configured to remember the user's password.
- **Demo mode** which lets users explore the full UI with simulated accounts, no YubiKey required.

Beyond that: tap-to-reveal accounts, rename/delete, OATH password support, multi-key switching,
system tray with autostart, and search. No secrets are ever stored by Entico Auth - only
non-sensitive settings like window/tray behavior, or custom key names are persisted.

## Requirements

- Windows 10/11
- The official [YubiKey Manager](https://developers.yubico.com/yubikey-manager/Releases/) (`ykman.exe`)
  installed
- A YubiKey with the OATH application enabled
- Optional: Windows Hello enrolled, for additional write-protection when `ykman` remembers your password

## Installation

Download the latest installer (`.msi` or `.exe`) from the
[Releases](https://github.com/zolex/entico-auth/releases) page and run it.

## Demo

No YubiKey or `ykman` install handy? Pick "Try Demo" from the menu. It swaps in fully simulated
keys with a few sample accounts, computed with real TOTP math, so codes tick over just like the
real thing. Every feature works against it - add, rename, delete, touch-required reveal, multi-key diff - nothing here ever touches actual hardware or `ykman.exe`. A banner stays on screen the whole time so it's never mistaken for a real key. Exit any time from the same menu.

### Menu with multiple YukiKeys
<img src="docs/demo1.png" alt="Account grid in demo mode" />

### YoubiKey Touch protection
<img src="docs/demo3.png" alt="Demo mode, third screenshot" />

### Yubikey Diff
<img src="docs/demo2.png" alt="Demo mode, second screenshot" />





