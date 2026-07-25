import { defineStore } from 'pinia'
import { ykman } from '../lib/ykman-client'
import type { YubiKeyInfo, YkmanError } from '../lib/types'

export const useKeysStore = defineStore('keys', {
  state: () => ({
    keys: [] as YubiKeyInfo[],
    activeSerial: null as string | null,
    ykmanMissing: false,
    // A user-set override for how a key's name is displayed everywhere
    // (menus, dialog headers, the OATH diff, ...), keyed by serial. Loaded
    // once from persisted settings (see the checkOnce guard below) rather
    // than re-fetched every poll cycle.
    keyNames: {} as Record<string, string>,
    keyNamesLoaded: false,
    // The device's own reported name per serial, kept separately from
    // `keyNames` so setKeyName can fall back to it when a custom name is
    // cleared, without needing another round-trip to ykman.
    deviceNames: {} as Record<string, string>,
  }),
  actions: {
    // Returns whether the underlying ykman call succeeded, so callers (see
    // checkOnceWithRetry below) can tell a transient failure apart from a
    // clean result without re-deriving the same try/catch.
    async checkOnce(): Promise<boolean> {
      if (!this.keyNamesLoaded) {
        try {
          this.keyNames = (await ykman.getSettings()).keyNames
          this.keyNamesLoaded = true
        } catch {
          // Transient read failure - try loading again on the next checkOnce.
        }
      }
      try {
        const rawKeys = await ykman.listKeys()
        this.ykmanMissing = false
        const serials = rawKeys.map((k) => k.serial)
        for (const k of rawKeys) this.deviceNames[k.serial] = k.name
        const keys = rawKeys.map((k) => ({ serial: k.serial, name: this.keyNames[k.serial] ?? k.name }))
        this.keys = keys
        if (this.activeSerial && !serials.includes(this.activeSerial)) {
          this.activeSerial = null
        }
        if (!this.activeSerial && keys.length === 1) {
          this.activeSerial = keys[0].serial
        }
        return true
      } catch (e) {
        const err = e as YkmanError
        if (err.kind === 'NotFound') {
          // ykman itself is missing - there's nothing to check for.
          this.ykmanMissing = true
          this.keys = []
          this.activeSerial = null
        }
        // Any other error (e.g. NoKeyConnected) is not proof the key is
        // gone - it's frequently just this check losing a race for exclusive
        // CCID access against another ykman invocation (see run_ykman's
        // process-global mutex comment). Leave keys/activeSerial as they
        // were so an in-flight action relying on activeSerial (e.g. the
        // password-change dialog) doesn't silently no-op.
        return false
      }
    },
    // A key that was just plugged in can briefly fail CCID enumeration before
    // Windows/ykman finish settling it. There's no polling loop left to
    // paper over that with a next tick, so an arrival-triggered checkOnce()
    // gets a short retry-with-backoff instead, following the same shape as
    // resolveOathStatus's retry loop (lib/oathStatusResolver.ts). A removal
    // is expected to reliably report an empty list rather than error, so
    // callers only use this for arrivals.
    async checkOnceWithRetry(opts: { retries?: number; retryDelayMs?: number } = {}): Promise<void> {
      const retries = opts.retries ?? 3
      const retryDelayMs = opts.retryDelayMs ?? 800
      for (let attempt = 0; attempt <= retries; attempt++) {
        const ok = await this.checkOnce()
        if (ok || attempt === retries) return
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    },
    selectKey(serial: string) {
      this.activeSerial = serial
    },
    // Not a YubiKey write - this only edits local settings.json, so it
    // deliberately doesn't go through requirePresence() the way OATH writes
    // in ykman-client.ts do.
    async setKeyName(serial: string, name: string | null) {
      const trimmed = name?.trim() || null
      await ykman.setKeyName(serial, trimmed)
      if (trimmed) {
        this.keyNames[serial] = trimmed
      } else {
        delete this.keyNames[serial]
      }
      const key = this.keys.find((k) => k.serial === serial)
      if (key) key.name = trimmed ?? this.deviceNames[serial] ?? key.name
    },
  },
})
