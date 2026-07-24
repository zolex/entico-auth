import { defineStore } from 'pinia'
import { ykman } from '../lib/ykman-client'
import { useKeysStore } from './keys'
import { useUiStore } from './ui'
import { nextBoundaryMs, progressFraction } from '../lib/totp-timing'

// Touching now for a code that's about to expire anyway just means touching
// again moments later - wait out the rest of the period first so the touch
// yields a code good for a nearly-full period instead.
const MIN_REVEAL_WINDOW_MS = 5000

export interface DisplayAccount {
  query: string
  issuer: string | null
  name: string
  period: number
  touchRequired: boolean
  code: string | null
  // When a touch-revealed code is still valid until (ms epoch), so a
  // background refresh landing moments after a reveal doesn't wipe it out -
  // oathGetCodes never returns touch-required codes at all, so a codes
  // merge would otherwise read that as "no code" and null it out immediately.
  codeExpiresAt: number | null
}

interface AccountMetadata {
  query: string
  issuer: string | null
  name: string
  period: number
}

interface CodeEntry {
  query: string
  code: string | null
}

// Shared by refresh() (fresh metadata + codes) and refreshCodes() (codes
// merged onto the metadata already held in `accounts`), so the touch/expiry
// preservation logic below can't drift between the two call sites.
function mergeCodes(previous: DisplayAccount[], metadata: AccountMetadata[], codes: CodeEntry[]): DisplayAccount[] {
  const codeByQuery = new Map(codes.map((c) => [c.query, c.code]))
  const previousByQuery = new Map(previous.map((a) => [a.query, a]))
  const now = Date.now()
  return metadata.map((m) => {
    const fetchedCode = codeByQuery.get(m.query) ?? null
    const prev = previousByQuery.get(m.query)
    if (fetchedCode === null && prev?.code && prev.codeExpiresAt && now < prev.codeExpiresAt) {
      return { ...prev, touchRequired: true }
    }
    return {
      query: m.query,
      issuer: m.issuer,
      name: m.name,
      period: m.period,
      touchRequired: fetchedCode === null,
      code: fetchedCode,
      codeExpiresAt: null,
    }
  })
}

export const useAccountsStore = defineStore('accounts', {
  state: () => ({
    accounts: [] as DisplayAccount[],
    // Which key `accounts` currently holds data for, so a refresh for a
    // newly selected key never merges-by-query against another key's
    // accounts (see `refresh` below).
    loadedSerial: null as string | null,
    refreshHandle: null as ReturnType<typeof setTimeout> | null,
    loading: false,
    revealWaiting: false,
  }),
  actions: {
    async refresh() {
      const serial = useKeysStore().activeSerial
      if (!serial) {
        this.accounts = []
        this.loadedSerial = null
        return
      }
      if (serial !== this.loadedSerial) {
        // Switching keys: clear immediately, before the async fetch below,
        // so neither the UI nor the merge-by-query logic ever attributes
        // the previous key's accounts (codes, touch state) to this one.
        this.accounts = []
      }
      const password = useUiStore().sessionPasswordFor(serial)
      const [metadata, codes] = await Promise.all([
        ykman.oathListAccounts(serial, password),
        ykman.oathGetCodes(serial, password),
      ])
      this.accounts = mergeCodes(this.accounts, metadata, codes)
      this.loadedSerial = serial
      this.reconcilePeriodicRefresh()
    },
    // Metadata (issuer/name/period) almost never changes between full
    // refreshes, and a touch-required account never returns a code at all -
    // so the periodic tick only re-fetches codes, merging them onto the
    // metadata `accounts` already holds instead of re-fetching it every time.
    async refreshCodes() {
      const serial = useKeysStore().activeSerial
      if (!serial || serial !== this.loadedSerial) return
      const password = useUiStore().sessionPasswordFor(serial)
      const codes = await ykman.oathGetCodes(serial, password)
      this.accounts = mergeCodes(this.accounts, this.accounts, codes)
    },
    // Decides whether the codes-only periodic loop should be running, based
    // on whether any account can actually produce a code on its own - an
    // all-touch-required account set never returns anything from
    // oathGetCodes, so ticking for it is pure waste. Safe to call after every
    // refresh()/refreshCodes(): it's a no-op if the loop is already in the
    // state it should be in.
    reconcilePeriodicRefresh() {
      const needsPeriodicRefresh = this.accounts.some((a) => !a.touchRequired)
      if (needsPeriodicRefresh) {
        if (!this.refreshHandle) this.scheduleNextCodesRefresh()
      } else {
        this.stopAutoRefresh()
      }
    },
    scheduleNextCodesRefresh() {
      const soonestPeriod = this.accounts.reduce((min, a) => Math.min(min, a.period), 30)
      const delay = Math.max(250, nextBoundaryMs(Date.now(), soonestPeriod) - Date.now())
      this.refreshHandle = setTimeout(async () => {
        this.refreshHandle = null
        await this.refreshCodes()
        this.reconcilePeriodicRefresh()
      }, delay)
    },
    startAutoRefresh() {
      this.stopAutoRefresh()
      this.loading = true
      return this.refresh().then(() => {
        this.loading = false
      })
    },
    stopAutoRefresh() {
      if (this.refreshHandle) clearTimeout(this.refreshHandle)
      this.refreshHandle = null
    },
    async revealTouchCode(query: string) {
      const serial = useKeysStore().activeSerial
      if (!serial) return
      const account = this.accounts.find((a) => a.query === query)
      if (account) {
        const remainingMs = progressFraction(Date.now(), account.period) * account.period * 1000
        if (remainingMs < MIN_REVEAL_WINDOW_MS) {
          this.revealWaiting = true
          await new Promise((resolve) => setTimeout(resolve, remainingMs))
          this.revealWaiting = false
        }
      }
      const code = await ykman.oathGetTouchCode(serial, query, useUiStore().sessionPasswordFor(serial))
      const revealed = this.accounts.find((a) => a.query === query)
      if (revealed) {
        const now = Date.now()
        revealed.code = code
        // progressFraction (not a raw nextBoundaryMs call) so landing exactly
        // on a boundary is treated as a full period remaining, not zero.
        revealed.codeExpiresAt = now + progressFraction(now, revealed.period) * revealed.period * 1000
      }
    },
    async addManual(input: {
      issuer: string | null
      name: string
      secret: string
      digits: number
      algorithm: string
      period: number
      touchRequired: boolean
    }) {
      const serial = useKeysStore().activeSerial
      if (!serial) return
      await ykman.oathAddManual(serial, input, useUiStore().sessionPasswordFor(serial))
      await this.refresh()
    },
    async rename(query: string, newIssuer: string | null, newName: string) {
      const serial = useKeysStore().activeSerial
      if (!serial) return
      await ykman.oathRename(serial, query, newIssuer, newName, useUiStore().sessionPasswordFor(serial))
      await this.refresh()
    },
    async remove(query: string) {
      const serial = useKeysStore().activeSerial
      if (!serial) return
      await ykman.oathDelete(serial, query, useUiStore().sessionPasswordFor(serial))
      await this.refresh()
    },
  },
})
