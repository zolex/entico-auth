import { defineStore } from 'pinia'
import { ykman } from '../lib/ykman-client'
import type { YubiKeyInfo, YkmanError } from '../lib/types'

export const useKeysStore = defineStore('keys', {
  state: () => ({
    keys: [] as YubiKeyInfo[],
    activeSerial: null as string | null,
    ykmanMissing: false,
  }),
  actions: {
    // Returns whether the underlying ykman call succeeded, so callers (see
    // checkOnceWithRetry below) can tell a transient failure apart from a
    // clean result without re-deriving the same try/catch.
    async checkOnce(): Promise<boolean> {
      try {
        const keys = await ykman.listKeys()
        this.ykmanMissing = false
        const serials = keys.map((k) => k.serial)
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
  },
})
