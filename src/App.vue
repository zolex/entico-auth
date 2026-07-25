<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Pencil, Trash2 } from '@lucide/vue'
import { useKeysStore } from './stores/keys'
import { useAccountsStore } from './stores/accounts'
import { useUiStore } from './stores/ui'
import { ykman, describeYkmanError } from './lib/ykman-client'
import { resolveOathStatus } from './lib/oathStatusResolver'
import { PresenceCancelledError } from './lib/presence'
import { debounceFocusLoss } from './lib/debounceFocusLoss'
import TitleBar from './components/TitleBar.vue'
import BurgerMenu from './components/BurgerMenu.vue'
import AccountGrid from './components/AccountGrid.vue'
import AddAccountSheet from './components/AddAccountSheet.vue'
import AddSpeedDial from './components/AddSpeedDial.vue'
import UnlockDialog from './components/UnlockDialog.vue'
import TouchDialog from './components/TouchDialog.vue'
import EmptyState from './components/EmptyState.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import RenameDialog from './components/RenameDialog.vue'
import PasswordSettingsSheet from './components/PasswordSettingsSheet.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import OathDiffView from './components/OathDiffView.vue'
import RenameKeyDialog from './components/RenameKeyDialog.vue'
import LoadingSpinner from './components/LoadingSpinner.vue'
import InfoDialog from './components/InfoDialog.vue'

const keys = useKeysStore()
const accounts = useAccountsStore()
const ui = useUiStore()

// The banner's own height (0 when not in demo mode) - exposed as a CSS var
// so every fixed-position overlay (dialogs, menus, TouchDialog) can offset
// itself below it instead of being covered by it. Measured rather than
// hardcoded since the banner's text wraps at narrow window widths.
const demoBannerRef = ref<HTMLElement | null>(null)
const demoBannerHeight = ref(0)
let demoBannerObserver: ResizeObserver | null = null
watch(demoBannerRef, (el) => {
  demoBannerObserver?.disconnect()
  demoBannerObserver = null
  demoBannerHeight.value = el?.offsetHeight ?? 0
  if (el) {
    demoBannerObserver = new ResizeObserver(([entry]) => {
      // contentRect excludes padding/border - offsetHeight matches the
      // initial measurement above and what the layout actually reserves.
      demoBannerHeight.value = (entry.target as HTMLElement).offsetHeight
    })
    demoBannerObserver.observe(el)
  }
})
onUnmounted(() => demoBannerObserver?.disconnect())

const menuOpen = ref(false)
const searchOpen = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const speedDialOpen = ref(false)
const addOpen = ref(false)
const addMode = ref<'manual' | 'uri' | 'qr'>('manual')
const passwordProtected = ref(false)
const revealing = ref(false)
const oathDisabled = ref(false)
const statusChecking = ref(false)
const passwordSheetOpen = ref(false)
const settingsOpen = ref(false)
const aboutOpen = ref(false)
const oathDiffOpen = ref(false)
const renameKeyOpen = ref(false)
const unlockBusy = ref(false)
const unlockError = ref<string | null>(null)
const passwordSuccessMessage = ref<string | null>(null)
// A minimized or tray-hidden window can never hold OS focus, so tracking
// focus alone would in principle be enough to gate all periodic ykman
// polling (key presence, account/code refresh) for every "backgrounded"
// case. In practice Tauri's focus-changed event is unreliable on Windows in
// two different directions: it silently stops firing across a tray
// hide()/show() cycle after the second show() (tauri-apps/tauri#13633), and
// it fires a spurious lost/regained pair on any click or drag inside a
// data-tauri-drag-region element - our title bar, and an undecorated
// window's own resize borders - even without an actual drag
// (tauri-apps/tauri#10767). The former is why tray visibility is tracked
// independently via an explicit "window-visibility" event emitted by the
// Rust side's own hide()/show() call sites (tray.rs, lib.rs) rather than
// derived from focus; the latter is why the raw focus signal is routed
// through debounceFocusLoss (see onMounted below) before landing here,
// so a sub-300ms blip from clicking or resizing the chrome never triggers
// the accounts refetch below. Both start false (rather than assuming true)
// so polling never begins before we've actually confirmed the window is
// focused and visible; see the isFocused()/isVisible() checks in onMounted
// below.
const appFocused = ref(false)
const windowVisible = ref(false)
const canPoll = computed(() => appFocused.value && windowVisible.value)

// A hotplug stream only reports *changes*, not pre-existing state, so
// something has to establish "what's already connected" once. Whichever
// happens first - the window becoming focused+visible, or the first
// yubikey-usb-change event - runs that one-shot baseline checkOnce(); the
// other is then skipped via this shared flag so it isn't done twice. See
// the onUsbChange handler and the canPoll watch below.
let baselineKeyCheckDone = false

const contextMenu = ref<{ visible: boolean; query: string; x: number; y: number }>({
  visible: false,
  query: '',
  x: 0,
  y: 0,
})
const renameDialog = ref<{
  visible: boolean
  query: string
  issuer: string
  name: string
  busy: boolean
  error: string | null
}>({
  visible: false,
  query: '',
  issuer: '',
  name: '',
  busy: false,
  error: null,
})
const deleteConfirm = ref<{ visible: boolean; query: string; busy: boolean; error: string | null }>({
  visible: false,
  query: '',
  busy: false,
  error: null,
})

onMounted(() => {
  // The tray's "Lock Now" menu item emits this event; without a listener it
  // would be a dead menu item.
  listen('lock-now', () => ui.lock())

  const win = getCurrentWindow()
  const setAppFocused = debounceFocusLoss((focused) => {
    appFocused.value = focused
  })
  win.onFocusChanged(({ payload: focused }) => setAppFocused(focused))
  win.isFocused().then(setAppFocused)
  win.isVisible().then((visible) => {
    windowVisible.value = visible
  })
  listen<boolean>('window-visibility', ({ payload: visible }) => {
    windowVisible.value = visible
  })
  listen<'arrival' | 'removal'>('yubikey-usb-change', ({ payload }) => onUsbChange(payload))

  ykman
    .getSettings()
    .then((settings) => {
      ui.idleLockMinutes = settings.idleLockMinutes
    })
    .catch(() => {
      // No persisted settings yet (or a transient read failure) - idle
      // auto-lock simply stays off (its default) until the next app start.
    })

  // Covers a `--demo` launch, where demo mode is already active in the
  // backend before the frontend ever mounts.
  ykman.isDemoMode().then((active) => {
    ui.demoMode = active
  })

  window.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', onGlobalKeydown)
})

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (contextMenu.value.visible) {
      closeContextMenu()
      return
    }
    if (searchOpen.value) closeSearch()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    if (!canSearch.value) return
    e.preventDefault()
    toggleSearch()
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

// Both directions just mean "re-list and reconcile" - the only difference is
// that an arrival gets the retry-with-backoff (a key that was *just* plugged
// in can briefly fail CCID enumeration before Windows/ykman finish settling
// it), while a removal is expected to reliably report an empty list rather
// than error, so it doesn't need one.
async function onUsbChange(kind: 'arrival' | 'removal') {
  baselineKeyCheckDone = true
  if (kind === 'arrival') {
    await keys.checkOnceWithRetry()
  } else {
    await keys.checkOnce()
  }
}

// Every "trigger" in the title bar/chrome (menu, search, the add-account
// fab) opens something that visually competes with whatever else is
// currently up - a full-page dialog, the sidebar, the speed dial, the
// account context menu. Opening one should close the others, the same way
// clicking their own backdrop already does. This is only ever called from
// those triggers' own click handlers, never from a generic window-level
// listener - so dragging or double-clicking the plain title bar background
// (which doesn't hit any of these buttons) never triggers it.
function closeTransientUI(except?: 'menu' | 'speedDial') {
  closeContextMenu()
  if (except !== 'menu') menuOpen.value = false
  if (except !== 'speedDial') speedDialOpen.value = false
  addOpen.value = false
  renameDialog.value.visible = false
  deleteConfirm.value.visible = false
  settingsOpen.value = false
  aboutOpen.value = false
  oathDiffOpen.value = false
  renameKeyOpen.value = false
  passwordSheetOpen.value = false
  passwordSuccessMessage.value = null
}

function toggleSearch() {
  if (searchOpen.value) {
    closeSearch()
    return
  }
  closeTransientUI()
  searchOpen.value = true
}

function closeSearch() {
  searchOpen.value = false
  ui.searchQuery = ''
}

function openAdd(mode: 'manual' | 'uri' | 'qr') {
  closeTransientUI()
  addMode.value = mode
  addOpen.value = true
}

function openSettings() {
  closeTransientUI()
  settingsOpen.value = true
}

function openAbout() {
  closeTransientUI()
  aboutOpen.value = true
}

function openOathDiff() {
  closeTransientUI()
  oathDiffOpen.value = true
}

function openRenameKey() {
  closeTransientUI()
  renameKeyOpen.value = true
}

// Entering/exiting demo mode doesn't touch real key/password/session state -
// it just swaps what the backend's ykman-shaped commands return (see
// src-tauri/src/demo.rs), then re-runs the same key check the app already
// does on startup/hotplug to pick up the swapped data.
async function toggleDemo() {
  closeTransientUI()
  if (ui.demoMode) {
    await ykman.exitDemoMode()
  } else {
    await ykman.enterDemoMode()
  }
  ui.demoMode = !ui.demoMode
  keys.activeSerial = null
  await keys.checkOnceWithRetry()
}

function openPasswordSettings() {
  closeTransientUI()
  passwordSheetOpen.value = true
}

function showPasswordSuccess(message: string) {
  closeTransientUI()
  passwordSuccessMessage.value = message
}

function toggleMenu() {
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  // The sidebar's own toggle button in the title bar stays reachable even
  // while a full-page dialog is open (those only cover the area below the
  // title bar) - but the sidebar renders behind them, so opening it while
  // one is up would otherwise look like nothing happened.
  closeTransientUI('menu')
  menuOpen.value = true
}

watch(speedDialOpen, (open) => {
  if (open) closeTransientUI('speedDial')
})

watch(searchOpen, async (open) => {
  if (!open) return
  await nextTick()
  searchInputRef.value?.focus()
})

// On startup, if several keys are already plugged in, keys.checkOnce() can't
// auto-select one (it only does that for a single key) - open the sidebar
// so the user can pick. A flag rather than a one-shot watch, since the
// second key may only show up a check or two after the first.
let autoOpenedKeyPicker = false
watch(
  () => keys.keys.length,
  (count) => {
    if (autoOpenedKeyPicker || count <= 1 || keys.activeSerial) return
    menuOpen.value = true
    autoOpenedKeyPicker = true
  },
)

function onCardContextMenu(query: string, x: number, y: number) {
  contextMenu.value = { visible: true, query, x, y }
}

function openRename() {
  const query = contextMenu.value.query
  const account = accounts.accounts.find((a) => a.query === query)
  closeTransientUI()
  renameDialog.value = {
    visible: true,
    query,
    issuer: account?.issuer ?? '',
    name: account?.name ?? '',
    busy: false,
    error: null,
  }
}

function openDelete() {
  const query = contextMenu.value.query
  closeTransientUI()
  deleteConfirm.value = { visible: true, query, busy: false, error: null }
}

async function onRenameSubmit(newIssuer: string | null, newName: string) {
  renameDialog.value.busy = true
  renameDialog.value.error = null
  try {
    await accounts.rename(renameDialog.value.query, newIssuer, newName)
    renameDialog.value.visible = false
  } catch (e) {
    if (e instanceof PresenceCancelledError) return
    renameDialog.value.error = describeYkmanError(e)
  } finally {
    renameDialog.value.busy = false
  }
}

async function onDeleteConfirm() {
  deleteConfirm.value.busy = true
  deleteConfirm.value.error = null
  try {
    await accounts.remove(deleteConfirm.value.query)
    deleteConfirm.value.visible = false
  } catch (e) {
    if (e instanceof PresenceCancelledError) return
    deleteConfirm.value.error = describeYkmanError(e)
  } finally {
    deleteConfirm.value.busy = false
  }
}

async function refreshPasswordProtected() {
  if (!keys.activeSerial) return
  try {
    const status = await ykman.oathStatus(keys.activeSerial)
    passwordProtected.value = status.passwordProtected
  } catch {
    // Transient failure; keep the previously-known state rather than
    // surfacing an unhandled rejection here.
  }
}

watch(
  () => keys.activeSerial,
  async (serial) => {
    accounts.stopAutoRefresh()
    oathDisabled.value = false
    if (!serial) {
      statusChecking.value = false
      return
    }
    statusChecking.value = true
    try {
      // A key that was just plugged in (or just noticed by the poller) can
      // briefly fail this check while Windows/ykman finish enumerating it -
      // resolveOathStatus retries through that instead of us giving up after
      // one failed attempt, which used to strand the UI with neither a
      // loading spinner nor an unlock prompt until the key was replugged.
      const outcome = await resolveOathStatus(serial, ykman)
      switch (outcome.kind) {
        case 'unprotected':
          passwordProtected.value = false
          ui.unlock()
          // Explicit, not relied-on-via-watch: switching between two keys
          // that are both already unlocked (e.g. two unprotected keys)
          // leaves `locked` at `false` the whole time, so the watch on
          // ui.locked below never fires - without this direct call,
          // accounts never reload and the UI is stuck showing the previous
          // key's accounts. (That watch only handles stopping refresh on
          // lock; every unlock path here triggers refresh explicitly, so
          // there's exactly one refresh per unlock, not a race between two.)
          accounts.startAutoRefresh()
          break
        case 'remembered':
          // oath info itself reports ykman already remembers this key's
          // password - skip the dialog and rely on ykman's own cache. We
          // deliberately don't ask the user for it just to populate our own
          // sessionPassword: leaving it null means subsequent account calls
          // omit -p too, so ykman keeps using its remembered credential
          // exactly the way it would from the CLI directly.
          passwordProtected.value = true
          ui.unlock()
          accounts.startAutoRefresh() // see comment in the 'unprotected' case above
          break
        case 'locked':
          // oath info reported password protection is on and it's not
          // remembered by ykman itself: go straight to the unlock dialog,
          // unless we already validated this exact key's password earlier
          // in this session (see ui.sessionPasswords) - in that case reuse
          // it silently instead of re-prompting. We deliberately do not run
          // any other ykman command first to double check the remembered
          // case - that requires a command that falls back to an
          // interactive console prompt when nothing is remembered, and that
          // prompt hangs forever (it reads the console directly on Windows,
          // ignoring stdin redirection) instead of failing cleanly.
          passwordProtected.value = true
          if (ui.sessionPasswordFor(serial)) {
            ui.unlock()
            accounts.startAutoRefresh() // see comment in the 'unprotected' case above
          } else {
            ui.requireUnlock()
          }
          break
        case 'oath-disabled':
          oathDisabled.value = true
          break
        case 'unknown':
          // Every retry failed - a real, persistent ykman problem rather than
          // a momentary race. Stay locked; passwordProtected keeps its prior
          // value so a previously-known-protected key still gets an unlock
          // prompt instead of a silent blank screen. requireUnlock() (not the
          // full lock()) since a transient failure on this key shouldn't
          // forget other keys' already-validated passwords.
          ui.requireUnlock()
          break
      }
    } finally {
      statusChecking.value = false
    }
  },
)

// Only handles the lock direction (tray "Lock Now", the lock icon, idle
// timeout) - every unlock path calls accounts.startAutoRefresh() explicitly
// itself (see the activeSerial watch above and onUnlockSubmit below), so
// this deliberately doesn't also start refresh on unlock: `ui.locked` going
// true -> false already has an explicit trigger at every call site, and
// mirroring that here would fire a second, racing refresh() alongside it.
watch(
  () => ui.locked,
  (locked) => {
    if (locked) accounts.stopAutoRefresh()
  },
)

// Pauses/resumes the account/code refresh loop when the window loses/regains
// focus or visibility - this fires independently of the ui.locked watch
// above, since focus/visibility and lock state change via unrelated user
// actions, so there's no risk of the double-trigger the ui.locked/unlock
// split above was written to avoid. Also runs the one-shot baseline key
// check the first time the window is focused+visible, unless a
// yubikey-usb-change event already beat it to that (see onUsbChange above).
watch(canPoll, (can) => {
  if (can) {
    if (!baselineKeyCheckDone) {
      baselineKeyCheckDone = true
      keys.checkOnce()
    }
    if (!ui.locked) accounts.startAutoRefresh()
  } else {
    accounts.stopAutoRefresh()
  }
})

async function onUnlockSubmit(password: string, remember: boolean) {
  if (!keys.activeSerial) return
  unlockBusy.value = true
  unlockError.value = null
  try {
    if (passwordProtected.value) {
      await ykman.oathUnlock(keys.activeSerial, password, remember)
      ui.setSessionPassword(keys.activeSerial, password)
    }
    ui.unlock()
    accounts.startAutoRefresh() // see comment on the ui.locked watch above
  } catch (e) {
    unlockError.value = describeYkmanError(e)
  } finally {
    unlockBusy.value = false
  }
}

async function onCopy(code: string) {
  await navigator.clipboard.writeText(code)
  ui.showToast('Copied to clipboard')
  const period = accounts.accounts.find((a) => a.code === code)?.period ?? 30
  ui.scheduleClipboardClear(code, period)
}

async function onReveal(query: string) {
  revealing.value = true
  try {
    await accounts.revealTouchCode(query)
    const account = accounts.accounts.find((a) => a.query === query)
    if (account?.code) await onCopy(account.code)
  } finally {
    revealing.value = false
  }
}

const deleteAccountLabel = computed(() => {
  const account = accounts.accounts.find((a) => a.query === deleteConfirm.value.query)
  if (!account) return ''
  return account.issuer ? `${account.issuer} (${account.name})` : account.name
})

const showUnlockDialog = computed(
  () => !statusChecking.value && ui.locked && keys.activeSerial !== null && passwordProtected.value,
)
watch(showUnlockDialog, (show) => {
  if (show) unlockError.value = null
})
const showLoadingGate = computed(
  () =>
    keys.activeSerial !== null &&
    !oathDisabled.value &&
    (statusChecking.value ||
      (!ui.locked && accounts.loading && accounts.accounts.length === 0)),
)
const canSearch = computed(() => keys.activeSerial !== null && !accounts.loading)
watch(canSearch, (can) => {
  if (!can) closeSearch()
})
</script>

<template>
  <div
    class="app-shell"
    :style="{ '--demo-banner-h': `${demoBannerHeight}px` }"
    @mousemove="ui.noteActivity()"
    @keydown="ui.noteActivity()"
    @contextmenu.prevent
  >
    <!-- Blanket-disables the native right-click menu everywhere; anything that wants its own
         context menu (see AccountCard's contextmenu handler) already calls preventDefault()
         itself further down the bubble chain, so this only affects places nobody implemented. -->
    <TitleBar :locked="ui.locked" :can-search="canSearch" @toggle-menu="toggleMenu" @toggle-search="toggleSearch" @toggle-lock="ui.locked ? null : ui.lock()" />
    <BurgerMenu
      :visible="menuOpen"
      @close="menuOpen = false"
      @open-password-settings="openPasswordSettings"
      @open-settings="openSettings"
      @open-about="openAbout"
      @open-oath-diff="openOathDiff"
      @open-rename-key="openRenameKey"
      @toggle-demo="toggleDemo"
    />
    <div v-if="ui.demoMode" ref="demoBannerRef" class="demo-banner">
      Demo Mode, no real YubiKey [ Mobile password: mobile123, Backup password: backup123 ]
      <button @click="toggleDemo">Exit</button>
    </div>

    <div class="content-scroll">
      <EmptyState
        v-if="keys.ykmanMissing"
        kind="ykman-missing"
        @open-settings="openSettings"
        @try-demo="toggleDemo"
      />
      <EmptyState v-else-if="!keys.activeSerial && keys.keys.length === 0" kind="no-key" />
      <EmptyState v-else-if="!keys.activeSerial" kind="select-key" />
      <EmptyState v-else-if="oathDisabled" kind="oath-disabled" />
      <template v-else>
        <LoadingSpinner v-if="showLoadingGate" />
        <template v-else>
          <input
            v-if="searchOpen"
            ref="searchInputRef"
            v-model="ui.searchQuery"
            placeholder="Search…"
            class="search"
          />

          <AccountGrid
            v-if="!ui.locked"
            :accounts="accounts.accounts"
            :search-query="ui.searchQuery"
            @copy="onCopy"
            @reveal="onReveal"
            @contextmenu="onCardContextMenu"
          />

          <div
            v-if="contextMenu.visible"
            class="context-menu"
            :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
            @click.stop
          >
            <button @click="openRename"><Pencil :size="15" /> Rename</button>
            <button class="danger" @click="openDelete"><Trash2 :size="15" /> Delete</button>
          </div>

          <AddSpeedDial v-if="!ui.locked" v-model:open="speedDialOpen" @pick="openAdd" />
          <AddAccountSheet v-if="addOpen" :mode="addMode" @close="addOpen = false" />
        </template>

        <UnlockDialog
          :visible="showUnlockDialog && !menuOpen"
          :password-protected="passwordProtected"
          :busy="unlockBusy"
          :error="unlockError"
          @submit="onUnlockSubmit"
        />
        <TouchDialog :visible="revealing" :waiting="accounts.revealWaiting" />
      </template>
    </div>

    <RenameDialog
      :visible="renameDialog.visible"
      :issuer="renameDialog.issuer"
      :name="renameDialog.name"
      :query="renameDialog.query"
      :busy="renameDialog.busy"
      :error="renameDialog.error"
      @submit="onRenameSubmit"
      @cancel="renameDialog.visible = false"
      @close="renameDialog.visible = false"
    />
    <ConfirmDialog
      :visible="deleteConfirm.visible"
      message="Delete this account?"
      :emphasis="deleteAccountLabel"
      detail="This cannot be undone on the device."
      :busy="deleteConfirm.busy"
      :error="deleteConfirm.error"
      @confirm="onDeleteConfirm"
      @cancel="deleteConfirm.visible = false"
    />
    <PasswordSettingsSheet
      :visible="passwordSheetOpen"
      :password-protected="passwordProtected"
      @close="passwordSheetOpen = false"
      @changed="refreshPasswordProtected"
      @success="showPasswordSuccess"
    />
    <SettingsDialog :visible="settingsOpen" @close="settingsOpen = false" />
    <AboutDialog :visible="aboutOpen" @close="aboutOpen = false" />
    <OathDiffView :visible="oathDiffOpen" @close="oathDiffOpen = false" />
    <RenameKeyDialog :visible="renameKeyOpen" @close="renameKeyOpen = false" />
    <InfoDialog
      :visible="passwordSuccessMessage !== null"
      :message="passwordSuccessMessage ?? ''"
      @close="passwordSuccessMessage = null"
    />

    <div class="toast" v-if="ui.toastMessage">{{ ui.toastMessage }}</div>
  </div>
</template>

<style>
:root {
  --titlebar-h: 44px;
  --demo-banner-h: 0px;
  --color-primary: #9aca3c;
  --color-primary-hover: #86ab32;
  --color-primary-ink: #0a0a0a;
  --color-secondary: #005572;
  --color-secondary-hover: #00465e;
}
html, body { margin: 0; background: #0a0a0a; color: #f2f2f2; font-family: sans-serif; }

/* Shared button system, used by every dialog/alert in the app. */
.btn {
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--color-primary); color: var(--color-primary-ink); }
.btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-secondary { background: transparent; color: #a3a3a3; }
.btn-secondary:hover:not(:disabled) { color: #f2f2f2; }
.btn-danger { background: #ef4444; color: #ffffff; }
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-secondary-solid { background: var(--color-secondary); color: #f2f2f2; }
.btn-secondary-solid:hover:not(:disabled) { background: var(--color-secondary-hover); }
.btn-block { display: flex; width: 100%; padding: 13px 18px; border-radius: 24px; font-size: 15px; box-sizing: border-box; margin-top: 28px; }

/* Shared underlined form fields, used by every full-page dialog. */
.field { margin-top: 22px; position: relative; }
.field label { display: block; font-size: 13px; color: #7a7a7a; margin-bottom: 6px; }
.field input, .field select {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid #2a2a2a;
  color: #f2f2f2;
  font-size: 15px;
  padding: 6px 0;
  box-sizing: border-box;
  font-family: inherit;
}
.field input:focus, .field select:focus { outline: none; border-bottom-color: var(--color-primary); }
.field-icon-btn {
  position: absolute;
  right: 0;
  bottom: 6px;
  background: none;
  border: none;
  color: #7a7a7a;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  font-size: 15px;
}
.field-icon-btn:hover { color: #f2f2f2; }
.field.checkbox-field { display: flex; align-items: center; gap: 10px; }
.field.checkbox-field label { margin-bottom: 0; color: #f2f2f2; font-size: 14px; }
.field.checkbox-field .field-text { display: flex; flex-direction: column; gap: 2px; }
.field.checkbox-field .field-description { margin: 0; font-size: 12px; font-weight: 400; color: #7a7a7a; }
.field.checkbox-field.is-disabled { opacity: 0.5; }
.field-error { color: #ff6b6b; margin-top: 16px; font-size: 13px; }

/* Full-page dialog shell, used for anything you navigate "into" (Add,
   Rename, Settings, OATH password). Simple yes/no alerts stay as centered
   modals instead - see ConfirmDialog/InfoDialog/UnlockDialog. */
.page-dialog { position: fixed; top: calc(var(--titlebar-h) + var(--demo-banner-h)); left: 0; right: 0; bottom: 0; background: #0a0a0a; z-index: 30; display: flex; flex-direction: column; overflow-y: auto; }
.page-dialog-header { display: flex; align-items: center; gap: 18px; padding: 20px 24px; flex-shrink: 0; }
.page-dialog-back { display: inline-flex; align-items: center; justify-content: center; background: none; border: none; color: #f2f2f2; cursor: pointer; padding: 4px 8px; line-height: 1; border-radius: 6px; }
.page-dialog-back:hover:not(:disabled) { background: #202020; }
.page-dialog-back:disabled { opacity: 0.4; cursor: default; }
.page-dialog-body { padding: 8px 24px 32px; width: 100%; box-sizing: border-box; }

/* Full-width buttons only make sense once the window is narrow enough that
   they'd otherwise wrap or feel cramped - on a wide window let them shrink
   to fit their label instead of stretching edge to edge. */
@media (min-width: 640px) {
  .page-dialog-body .btn-block { width: fit-content; }
}
</style>

<style scoped>
.app-shell { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.content-scroll { flex: 1; overflow-y: auto; position: relative; }
.search { box-sizing: border-box; margin: 8px 12px; padding: 6px 10px; width: calc(100% - 24px); background: #161616; border: 1px solid #2a2a2a; color: #f2f2f2; border-radius: 4px; }
.demo-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--color-secondary);
  color: #f2f2f2;
  font-size: 13px;
  text-align: center;
}
.demo-banner button {
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  background: transparent;
  color: #f2f2f2;
  border: 1px solid rgba(242, 242, 242, 0.4);
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
}
.demo-banner button:hover { background: rgba(242, 242, 242, 0.15); }
.toast {
  position: fixed;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  background: #2a2a2a;
  color: #f2f2f2;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 40;
}
.context-menu {
  position: fixed;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 4px;
  min-width: 130px;
  display: flex;
  flex-direction: column;
  z-index: 20;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.context-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: #f2f2f2;
  text-align: left;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
}
.context-menu button:hover {
  background: #2a2a2a;
}
.context-menu button.danger {
  color: #ff6b6b;
}
</style>
