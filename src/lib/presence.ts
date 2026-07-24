import { invoke } from '@tauri-apps/api/core'
import { ykman } from './ykman-client'

export class PresenceCancelledError extends Error {}

type PresenceResult = 'Verified' | 'Unavailable' | 'Denied'

// The single choke point every YubiKey write goes through (see
// ykman-client.ts). No cached/"recently verified" window: this always makes
// a fresh call, so a second person at the keyboard can't slip a change
// through right after a legitimate verification.
export async function requirePresence(): Promise<void> {
  const settings = await ykman.getSettings()
  if (!settings.requireHelloForWrites) return
  const result = await invoke<PresenceResult>('verify_presence')
  if (result === 'Verified' || result === 'Unavailable') return
  throw new PresenceCancelledError()
}
