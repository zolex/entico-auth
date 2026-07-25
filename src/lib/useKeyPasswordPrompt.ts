import { ref } from 'vue'
import { resolveOathStatus } from './oathStatusResolver'
import { ykman, describeYkmanError } from './ykman-client'
import { useUiStore } from '../stores/ui'

export type PasswordResolution = { ok: true; password: string | null } | { ok: false; reason: string }

// Shared by any flow that fans an OATH write out across multiple connected
// keys (AddAccountSheet's "save to all/missing keys", RenameDialog's "rename
// on all keys"): resolves the password to use for a given key, prompting
// inline (via the returned pendingKey state) only when that key is locked
// and nothing is cached yet.
export function useKeyPasswordPrompt() {
  const pendingKey = ref<{ serial: string; name: string } | null>(null)
  const pendingPassword = ref('')
  const pendingRemember = ref(false)
  const pendingBusy = ref(false)
  const pendingError = ref<string | null>(null)
  let pendingResolve: ((result: string | 'skip') => void) | null = null

  function promptForPassword(serial: string, keyName: string): Promise<string | 'skip'> {
    return new Promise((resolve) => {
      pendingKey.value = { serial, name: keyName }
      pendingPassword.value = ''
      pendingRemember.value = false
      pendingError.value = null
      pendingResolve = resolve
    })
  }

  async function onPendingSubmit() {
    if (!pendingKey.value) return
    pendingBusy.value = true
    pendingError.value = null
    try {
      await ykman.oathUnlock(pendingKey.value.serial, pendingPassword.value, pendingRemember.value)
      useUiStore().setSessionPassword(pendingKey.value.serial, pendingPassword.value)
      const resolve = pendingResolve
      const password = pendingPassword.value
      pendingKey.value = null
      pendingResolve = null
      resolve?.(password)
    } catch (e) {
      pendingError.value = describeYkmanError(e)
    } finally {
      pendingBusy.value = false
    }
  }

  function onPendingSkip() {
    const resolve = pendingResolve
    pendingKey.value = null
    pendingResolve = null
    resolve?.('skip')
  }

  async function resolvePasswordForKey(serial: string, keyName: string): Promise<PasswordResolution> {
    const outcome = await resolveOathStatus(serial, ykman)
    switch (outcome.kind) {
      case 'unprotected':
      case 'remembered':
        return { ok: true, password: null }
      case 'oath-disabled':
        return { ok: false, reason: 'OATH is disabled on this key.' }
      case 'unknown':
        return { ok: false, reason: "Couldn't reach this key." }
      case 'locked': {
        const cached = useUiStore().sessionPasswordFor(serial)
        if (cached) return { ok: true, password: cached }
        const result = await promptForPassword(serial, keyName)
        if (result === 'skip') return { ok: false, reason: 'Skipped.' }
        return { ok: true, password: result }
      }
    }
  }

  return {
    pendingKey,
    pendingPassword,
    pendingRemember,
    pendingBusy,
    pendingError,
    resolvePasswordForKey,
    onPendingSubmit,
    onPendingSkip,
  }
}
