<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useUiStore } from '../stores/ui'
import { useKeysStore } from '../stores/keys'
import { ykman, describeYkmanError } from '../lib/ykman-client'
import FullPageDialog from './FullPageDialog.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const ui = useUiStore()
const keys = useKeysStore()
const minimizeToTray = ref(false)
const launchAtStartup = ref(false)
const minimizeOnAutostart = ref(false)
const rememberWindow = ref(false)
const showWindowOnKeyPlugin = ref(false)
const requireHelloForWrites = ref(false)
const helloAvailable = ref(false)
const ykmanPathInput = ref('')
const pathBusy = ref(false)
const pathError = ref<string | null>(null)
const pathMessage = ref<string | null>(null)

async function loadSettings() {
  try {
    const settings = await ykman.getSettings()
    minimizeToTray.value = settings.minimizeToTray
    launchAtStartup.value = settings.launchAtStartup
    minimizeOnAutostart.value = settings.minimizeOnAutostart
    rememberWindow.value = settings.rememberWindow
    showWindowOnKeyPlugin.value = settings.showWindowOnKeyPlugin
    requireHelloForWrites.value = settings.requireHelloForWrites
    ykmanPathInput.value = settings.ykmanPath ?? ''
  } catch {
    // No persisted settings yet (or a transient read failure) - leave the
    // fields at their defaults rather than surfacing an error here.
  }
}

async function loadHelloAvailability() {
  try {
    helloAvailable.value = await ykman.checkHelloAvailability()
  } catch {
    // Treat a failed probe the same as "not available" - a machine that
    // can't even answer this shouldn't offer a toggle that would just fail.
    helloAvailable.value = false
  }
}

onMounted(() => {
  loadSettings()
  loadHelloAvailability()
})
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadSettings()
      loadHelloAvailability()
      pathError.value = null
      pathMessage.value = null
    }
  },
)

function onIdleLockChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  ui.idleLockMinutes = value === '' ? null : Number(value)
  // Re-arm (or cancel) the idle timer immediately so the new setting takes
  // effect without waiting for the next user activity event.
  ui.noteActivity()
}

async function onMinimizeToTrayChange() {
  try {
    await ykman.setMinimizeToTray(minimizeToTray.value)
  } catch {
    // Revert the checkbox so it doesn't lie about the persisted state.
    minimizeToTray.value = !minimizeToTray.value
  }
}

async function onLaunchAtStartupChange() {
  try {
    await ykman.setLaunchAtStartup(launchAtStartup.value)
  } catch {
    // Revert the checkbox so it doesn't lie about the persisted state.
    launchAtStartup.value = !launchAtStartup.value
  }
}

async function onMinimizeOnAutostartChange() {
  try {
    await ykman.setMinimizeOnAutostart(minimizeOnAutostart.value)
  } catch {
    // Revert the checkbox so it doesn't lie about the persisted state.
    minimizeOnAutostart.value = !minimizeOnAutostart.value
  }
}

async function onRememberWindowChange() {
  try {
    await ykman.setRememberWindow(rememberWindow.value)
  } catch {
    // Revert the checkbox so it doesn't lie about the persisted state.
    rememberWindow.value = !rememberWindow.value
  }
}

async function onShowWindowOnKeyPluginChange() {
  try {
    await ykman.setShowWindowOnKeyPlugin(showWindowOnKeyPlugin.value)
  } catch {
    // Revert the checkbox so it doesn't lie about the persisted state.
    showWindowOnKeyPlugin.value = !showWindowOnKeyPlugin.value
  }
}

async function onRequireHelloForWritesChange() {
  try {
    await ykman.setRequireHelloForWrites(requireHelloForWrites.value)
  } catch {
    // Revert the checkbox so it doesn't lie about the persisted state.
    requireHelloForWrites.value = !requireHelloForWrites.value
  }
}

async function browseForPath() {
  const picked = await open({
    multiple: false,
    directory: false,
    defaultPath: 'C:\\Program Files\\Yubico\\YubiKey Manager CLI',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
  })
  if (typeof picked === 'string') ykmanPathInput.value = picked
}

async function savePath() {
  pathError.value = null
  pathMessage.value = null
  pathBusy.value = true
  try {
    await ykman.setYkmanPath(ykmanPathInput.value.trim())
    pathMessage.value = 'Saved.'
    await keys.checkOnce()
  } catch (e) {
    pathError.value = describeYkmanError(e)
  } finally {
    pathBusy.value = false
  }
}

async function autoDetect() {
  pathError.value = null
  pathMessage.value = null
  pathBusy.value = true
  try {
    await ykman.clearYkmanPath()
    ykmanPathInput.value = ''
    await keys.checkOnce()
    pathMessage.value = keys.ykmanMissing ? 'Still not found.' : 'Found.'
  } catch (e) {
    pathError.value = describeYkmanError(e)
  } finally {
    pathBusy.value = false
  }
}
</script>

<template>
  <FullPageDialog :visible="visible" title="Settings" hide-key @back="emit('close')">
    <div v-if="false" class="field">
      <label>Idle auto-lock</label>
      <select :value="ui.idleLockMinutes ?? ''" @change="onIdleLockChange">
        <option value="">Off</option>
        <option value="1">1 minute</option>
        <option value="5">5 minutes</option>
        <option value="15">15 minutes</option>
        <option value="30">30 minutes</option>
      </select>
    </div>
    <div class="field checkbox-field">
      <ToggleSwitch :model-value="minimizeToTray" @update:model-value="(v) => { minimizeToTray = v; onMinimizeToTrayChange() }" />
      <div class="field-text">
        <label>Minimize to tray</label>
        <p class="field-description">Closing the window keeps Entico Auth running in the system tray instead of quitting.</p>
      </div>
    </div>
    <div class="field checkbox-field">
      <ToggleSwitch :model-value="launchAtStartup" @update:model-value="(v) => { launchAtStartup = v; onLaunchAtStartupChange() }" />
      <div class="field-text">
        <label>Launch at Windows startup</label>
        <p class="field-description">Automatically start Entico Auth when you sign in to Windows.</p>
      </div>
    </div>
    <div class="field checkbox-field" :class="{ 'is-disabled': !launchAtStartup }">
      <ToggleSwitch
        :model-value="minimizeOnAutostart"
        :disabled="!launchAtStartup"
        @update:model-value="(v) => { minimizeOnAutostart = v; onMinimizeOnAutostartChange() }"
      />
      <div class="field-text">
        <label>Minimize on autostart</label>
        <p class="field-description">Start minimized to the tray instead of opening the window right away.</p>
      </div>
    </div>
    <div class="field checkbox-field">
      <ToggleSwitch :model-value="rememberWindow" @update:model-value="(v) => { rememberWindow = v; onRememberWindowChange() }" />
      <div class="field-text">
        <label>Remember window size and position</label>
        <p class="field-description">Restore the window to its last size and position next time you open the app.</p>
      </div>
    </div>
    <div class="field checkbox-field">
      <ToggleSwitch
        :model-value="showWindowOnKeyPlugin"
        @update:model-value="(v) => { showWindowOnKeyPlugin = v; onShowWindowOnKeyPluginChange() }"
      />
      <div class="field-text">
        <label>Show window when a key is plugged in</label>
        <p class="field-description">
          Automatically bring Entico Auth to the front when a YubiKey is connected. With "Minimize to tray" also on,
          it's sent back to the tray once the last key is removed.
        </p>
      </div>
    </div>

    <div class="field checkbox-field" :class="{ 'is-disabled': !helloAvailable }">
      <ToggleSwitch
        data-test="require-hello"
        :model-value="requireHelloForWrites"
        :disabled="!helloAvailable"
        @update:model-value="(v) => { requireHelloForWrites = v; onRequireHelloForWritesChange() }"
      />
      <div class="field-text">
        <label>Require Windows Hello to change key contents</label>
        <p class="field-description">
          Confirm with Windows Hello before adding, renaming, or deleting accounts, or changing the OATH password.
        </p>
        <p v-if="!helloAvailable" class="field-description" data-test="hello-unavailable">
          Windows Hello isn't set up on this device.
        </p>
      </div>
    </div>

    <div class="field">
      <label>ykman.exe path</label>
      <input data-test="ykman-path" v-model="ykmanPathInput" placeholder="Auto-detected" :disabled="pathBusy" />
    </div>
    <p v-if="pathError" class="field-error" data-test="path-error">{{ pathError }}</p>
    <p v-else-if="pathMessage" class="field-message" data-test="path-message">{{ pathMessage }}</p>
    <div class="path-actions">
      <button class="btn btn-secondary-solid" data-test="browse" :disabled="pathBusy" @click="browseForPath">Browse…</button>
      <button class="btn btn-secondary" data-test="auto-detect" :disabled="pathBusy" @click="autoDetect">Auto-detect</button>
      <button class="btn btn-primary" data-test="save-path" :disabled="pathBusy || !ykmanPathInput.trim()" @click="savePath">Save</button>
    </div>
  </FullPageDialog>
</template>

<style scoped>
.path-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.field-message { color: #9aca3c; margin-top: 16px; font-size: 13px; }
</style>
