import type { YkmanError } from './types'

export type OathStatusOutcome =
  | { kind: 'unprotected' }
  | { kind: 'remembered' }
  | { kind: 'locked' }
  | { kind: 'oath-disabled' }
  | { kind: 'unknown' }

export interface OathStatusClient {
  oathStatus: (serial: string) => Promise<{ passwordProtected: boolean; remembered: boolean }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// This deliberately runs nothing but `oath info` (via oathStatus) to decide.
// ykman's other oath commands fall back to an interactive console password
// prompt when no `-p` is given and none is remembered, and that prompt cannot
// be aborted by closing stdin (it reads the console directly on Windows) - a
// prior "probe with a real oath call to see if the password is remembered"
// design hung forever the moment nothing was remembered. `oath info` itself
// safely reports whether ykman already remembers the password (no auth
// needed to ask), so we can decide unlocked-vs-prompt from it directly.
export async function resolveOathStatus(
  serial: string,
  client: OathStatusClient,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<OathStatusOutcome> {
  const retries = opts.retries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 800

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const status = await client.oathStatus(serial)
      if (!status.passwordProtected) return { kind: 'unprotected' }
      return status.remembered ? { kind: 'remembered' } : { kind: 'locked' }
    } catch (e) {
      const err = e as YkmanError
      if (err.kind === 'OathDisabled') return { kind: 'oath-disabled' }
      if (attempt < retries) await sleep(retryDelayMs)
    }
  }
  return { kind: 'unknown' }
}
