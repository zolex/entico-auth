export interface YubiKeyInfo {
  serial: string
  name: string
}

export interface OathAccount {
  query: string
  issuer: string | null
  name: string
  period: number
  touchRequired: boolean
}

export interface OathCodeEntry {
  query: string
  code: string | null // null => touch required
}

export interface OathStatus {
  passwordProtected: boolean
  remembered: boolean
}

export interface KeyDetails {
  serial: string
  deviceType: string
  firmwareVersion: string
}

export interface AppSettings {
  idleLockMinutes: number | null
  launchAtStartup: boolean
  lastActiveSerial: string | null
  ykmanPath: string | null
  rememberWindow: boolean
  minimizeToTray: boolean
  minimizeOnAutostart: boolean
  showWindowOnKeyPlugin: boolean
  requireHelloForWrites: boolean
}

export type YkmanError =
  | { kind: 'NotFound' }
  | { kind: 'NoKeyConnected' }
  | { kind: 'WrongPassword' }
  | { kind: 'OathDisabled' }
  | { kind: 'Other'; message: string }
