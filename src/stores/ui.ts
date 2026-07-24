import { defineStore } from 'pinia'
import { nextBoundaryMs } from '../lib/totp-timing'

export const useUiStore = defineStore('ui', {
  state: () => ({
    locked: true,
    searchQuery: '',
    idleLockMinutes: null as number | null,
    idleHandle: null as ReturnType<typeof setTimeout> | null,
    toastMessage: null as string | null,
    toastHandle: null as ReturnType<typeof setTimeout> | null,
    // Held in memory only, never persisted to disk. ykman requires this on
    // every authenticated oath call once the key is password protected -
    // calling without it falls back to an interactive console prompt that
    // hangs forever - so we keep it for the session instead of relying on
    // ykman's own opt-in "remember on this device" cache. Keyed by key
    // serial so switching between multiple password-protected keys never
    // sends one key's password to another.
    sessionPasswords: {} as Record<string, string>,
  }),
  getters: {
    sessionPasswordFor: (state) => (serial: string) => state.sessionPasswords[serial] ?? null,
  },
  actions: {
    // Full security lock: used by tray "Lock Now", the lock icon, and idle
    // timeout. Forgets every key's password, not just the active one, so a
    // deliberate/timed lock re-requires auth everywhere (UI-only - never
    // calls ykman's own remember/forget commands).
    lock() {
      this.locked = true
      this.sessionPasswords = {}
    },
    // Light lock: shows the unlock dialog for the currently active key
    // without disturbing other keys' already-validated passwords.
    requireUnlock() {
      this.locked = true
    },
    setSessionPassword(serial: string, password: string) {
      this.sessionPasswords[serial] = password
    },
    clearSessionPassword(serial: string) {
      delete this.sessionPasswords[serial]
    },
    showToast(message: string, durationMs = 2000) {
      if (this.toastHandle) clearTimeout(this.toastHandle)
      this.toastMessage = message
      this.toastHandle = setTimeout(() => {
        this.toastMessage = null
      }, durationMs)
    },
    unlock() {
      this.locked = false
      this.noteActivity()
    },
    noteActivity() {
      if (this.idleHandle) clearTimeout(this.idleHandle)
      if (this.idleLockMinutes && !this.locked) {
        this.idleHandle = setTimeout(() => this.lock(), this.idleLockMinutes * 60_000)
      }
    },
    scheduleClipboardClear(code: string, periodSeconds: number) {
      const now = Date.now()
      const delay = nextBoundaryMs(now, periodSeconds) - now
      setTimeout(async () => {
        const current = await navigator.clipboard.readText().catch(() => '')
        if (current === code) {
          await navigator.clipboard.writeText('')
        }
      }, delay)
    },
  },
})
