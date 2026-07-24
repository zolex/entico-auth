use std::collections::HashMap;

use futures_lite::StreamExt;
use nusb::hotplug::HotplugEvent;
use nusb::{DeviceId, DeviceInfo, MaybeFuture};
use tauri::{AppHandle, Emitter};

use crate::settings;
use crate::tray;

// Yubico's registered USB vendor ID (https://devicehunt.com/view/type/usb/vendor/1050) -
// every YubiKey form factor enumerates under this VID, so filtering on it (rather than a
// specific product ID) covers all of them without needing to keep a product list in sync.
const YUBICO_VENDOR_ID: u16 = 0x1050;

pub const USB_CHANGE_EVENT: &str = "yubikey-usb-change";

// Spawns a task that lives for the app's entire lifetime, consuming nusb's hotplug stream.
// `nusb::watch_devices()` reports changes only (not pre-existing state), so a Disconnected
// event carries just a DeviceId with no vendor info attached - `known` is seeded from
// `list_devices()` up front and kept in sync so a removal can still be checked against the
// vendor ID of the device that was actually unplugged.
pub fn setup(app: &AppHandle) {
    let Ok(watch) = nusb::watch_devices() else {
        // Hotplug watching isn't available on this system; the frontend's focus-triggered
        // baseline check is the only way key state gets noticed from here on.
        return;
    };
    let mut known: HashMap<DeviceId, DeviceInfo> = nusb::list_devices()
        .wait()
        .map(|devices| {
            devices
                .filter(|d| d.vendor_id() == YUBICO_VENDOR_ID)
                .map(|d| (d.id(), d))
                .collect()
        })
        .unwrap_or_default();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut watch = watch;
        while let Some(event) = watch.next().await {
            let arrival = match event {
                HotplugEvent::Connected(device) => {
                    if device.vendor_id() != YUBICO_VENDOR_ID {
                        continue;
                    }
                    known.insert(device.id(), device);
                    true
                }
                HotplugEvent::Disconnected(id) => {
                    if known.remove(&id).is_none() {
                        continue;
                    }
                    false
                }
            };
            on_change(&app, arrival, known.is_empty());
        }
    });
}

// `last_key_removed` is only meaningful (and only checked) for a removal - it's the mirror
// image of the arrival auto-show below: once the very last YubiKey is unplugged, a user who's
// opted into both auto-show *and* tray-hiding almost certainly wants the window to get out of
// the way again automatically, the same way it invited itself to the front when a key showed
// up. Gated on both settings (not just show_window_on_key_plugin) because minimize_to_tray is
// what makes "hide" a place the window can come back from via the tray icon at all.
fn on_change(app: &AppHandle, arrival: bool, last_key_removed: bool) {
    // Re-read on every event (rather than caching at startup) so toggling either setting takes
    // effect immediately, matching the pattern watch_close_to_tray already uses in lib.rs.
    let settings = settings::load(app);
    if arrival && settings.show_window_on_key_plugin {
        tray::show_and_focus(app);
    } else if !arrival
        && last_key_removed
        && settings.show_window_on_key_plugin
        && settings.minimize_to_tray
    {
        tray::hide_to_tray(app);
    }
    let _ = app.emit(
        USB_CHANGE_EVENT,
        if arrival { "arrival" } else { "removal" },
    );
}
