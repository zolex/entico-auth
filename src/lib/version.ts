import { getVersion } from '@tauri-apps/api/app'

export async function getVersionLabel(): Promise<string> {
  if (import.meta.env.DEV) return `dev-${__GIT_BRANCH__}`
  return `v${await getVersion()}`
}
