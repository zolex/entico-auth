import { invoke } from '@tauri-apps/api/core'
import type { YubiKeyInfo, OathAccount, OathCodeEntry, OathStatus, KeyDetails, AppSettings } from './types'
import { PresenceCancelledError, requirePresence } from './presence'

export function describeYkmanError(e: unknown): string {
  if (e instanceof PresenceCancelledError) return 'Cancelled.'
  const err = e as { kind?: string; message?: string }
  if (err?.kind === 'WrongPassword') return 'Wrong password.'
  if (err?.kind === 'Other' && err.message) return err.message
  return 'Something went wrong talking to the YubiKey.'
}

export const ykman = {
  checkYkman: () => invoke<string>('check_ykman'),
  listKeys: () => invoke<YubiKeyInfo[]>('list_keys'),
  oathStatus: (serial: string) => invoke<OathStatus>('oath_status', { serial }),
  oathUnlock: (serial: string, password: string, remember: boolean) =>
    invoke<void>('oath_unlock', { serial, password, remember }),
  oathListAccounts: (serial: string, password: string | null) =>
    invoke<OathAccount[]>('oath_list_accounts', { serial, password }),
  oathGetCodes: (serial: string, password: string | null) =>
    invoke<OathCodeEntry[]>('oath_get_codes', { serial, password }),
  oathGetTouchCode: (serial: string, query: string, password: string | null) =>
    invoke<string>('oath_get_touch_code', { serial, query, password }),
  oathAddManual: async (
    serial: string,
    input: {
      issuer: string | null
      name: string
      secret: string
      digits: number
      algorithm: string
      period: number
      touchRequired: boolean
    },
    password: string | null,
  ) => {
    await requirePresence()
    return invoke<void>('oath_add_manual', {
      serial,
      issuer: input.issuer,
      name: input.name,
      secret: input.secret,
      digits: input.digits,
      algorithm: input.algorithm,
      period: input.period,
      touchRequired: input.touchRequired,
      password,
    })
  },
  oathAddUri: async (serial: string, uri: string, password: string | null) => {
    await requirePresence()
    return invoke<void>('oath_add_uri', { serial, uri, password })
  },
  oathRename: async (serial: string, query: string, newIssuer: string | null, newName: string, password: string | null) => {
    await requirePresence()
    return invoke<void>('oath_rename', { serial, query, newIssuer, newName, password })
  },
  oathDelete: async (serial: string, query: string, password: string | null) => {
    await requirePresence()
    return invoke<void>('oath_delete', { serial, query, password })
  },
  oathSetPassword: async (serial: string, currentPassword: string | null, newPassword: string, remember: boolean) => {
    await requirePresence()
    return invoke<void>('oath_set_password', { serial, currentPassword, newPassword, remember })
  },
  oathClearPassword: async (serial: string, currentPassword: string) => {
    await requirePresence()
    return invoke<void>('oath_clear_password', { serial, currentPassword })
  },
  oathRememberPassword: async (serial: string, password: string) => {
    await requirePresence()
    return invoke<void>('oath_remember_password', { serial, password })
  },
  oathForgetPassword: async (serial: string) => {
    await requirePresence()
    return invoke<void>('oath_forget_password', { serial })
  },
  keyInfo: (serial: string) => invoke<KeyDetails>('key_info', { serial }),
  checkHelloAvailability: () => invoke<boolean>('check_hello_availability'),
  getSettings: () => invoke<AppSettings>('get_settings'),
  setLaunchAtStartup: (enabled: boolean) => invoke<void>('set_launch_at_startup', { enabled }),
  setRememberWindow: (enabled: boolean) => invoke<void>('set_remember_window', { enabled }),
  setMinimizeToTray: (enabled: boolean) => invoke<void>('set_minimize_to_tray', { enabled }),
  setMinimizeOnAutostart: (enabled: boolean) => invoke<void>('set_minimize_on_autostart', { enabled }),
  setShowWindowOnKeyPlugin: (enabled: boolean) => invoke<void>('set_show_window_on_key_plugin', { enabled }),
  // Gated like the 8 YubiKey writes above (not one of the "local app-settings
  // writes" that stay ungated) - otherwise a second person could disable the
  // whole protection without ever having to prove presence themselves.
  setRequireHelloForWrites: async (enabled: boolean) => {
    await requirePresence()
    return invoke<void>('set_require_hello_for_writes', { enabled })
  },
  setYkmanPath: (path: string) => invoke<void>('set_ykman_path', { path }),
  clearYkmanPath: () => invoke<void>('clear_ykman_path'),
  setKeyName: (serial: string, name: string | null) => invoke<void>('set_key_name', { serial, name }),
  enterDemoMode: () => invoke<void>('enter_demo_mode'),
  exitDemoMode: () => invoke<void>('exit_demo_mode'),
  isDemoMode: () => invoke<boolean>('is_demo_mode'),
}
