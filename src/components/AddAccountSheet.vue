<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { useAccountsStore } from '../stores/accounts'
import { useKeysStore } from '../stores/keys'
import { useUiStore } from '../stores/ui'
import { decodeQrFromImageData } from '../lib/qr-decode'
import { parseOtpauthUri, type ParsedOtpauth } from '../lib/otpauth'
import { ykman, describeYkmanError } from '../lib/ykman-client'
import { resolveOathStatus } from '../lib/oathStatusResolver'
import { PresenceCancelledError } from '../lib/presence'
import LoadingSpinner from './LoadingSpinner.vue'
import FullPageDialog from './FullPageDialog.vue'
import PasswordField from './PasswordField.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const props = withDefaults(defineProps<{ mode?: 'manual' | 'uri' | 'qr' }>(), { mode: 'manual' })
const emit = defineEmits<{ close: [] }>()
const accounts = useAccountsStore()
const keys = useKeysStore()
const ui = useUiStore()

// Starts as whatever entry mode the speed-dial button picked; a successful
// QR decode or URI parse below flips this to 'manual' so the user can
// review/edit the prefilled fields before saving, same as if they'd typed
// them in by hand.
const display = ref(props.mode)

const issuer = ref('')
const name = ref('')
const secret = ref('')
const digits = ref(6)
const algorithm = ref('SHA1')
const period = ref(30)
const touchRequired = ref(false)
const showAdvanced = ref(false)

const uri = ref('')

const qrFileInput = ref<HTMLInputElement | null>(null)
const qrError = ref('')
const error = ref('')
const busy = ref(false)

// Only worth offering once there's more than one connected key to fan out to
// - with a single key it would just duplicate the regular Save button.
const showSaveAll = computed(() => keys.keys.length > 1)

interface SaveAllResult {
  serial: string
  name: string
  status: 'ok' | 'error'
  message?: string
}
const saveAllBusy = ref(false)
const saveAllResults = ref<SaveAllResult[] | null>(null)

// While saving to all keys, a key whose OATH password isn't cached yet pauses
// the sequence and surfaces this inline prompt instead of the global
// UnlockDialog - that dialog reads keys.activeSerial directly and is wired
// into the app's own lock/relock state machine, which we don't want to
// disturb just to ask for a different (non-active) key's password here.
const pendingKey = ref<{ serial: string; name: string } | null>(null)
const pendingPassword = ref('')
const pendingRemember = ref(false)
const pendingBusy = ref(false)
const pendingError = ref<string | null>(null)
let pendingResolve: ((result: string | 'skip') => void) | null = null

function applyParsedAccount(parsed: ParsedOtpauth) {
  issuer.value = parsed.issuer || ''
  name.value = parsed.name
  secret.value = parsed.secret
  digits.value = parsed.digits
  algorithm.value = parsed.algorithm
  period.value = parsed.period
  if (parsed.algorithm !== 'SHA1' || parsed.digits !== 6 || parsed.period !== 30) {
    showAdvanced.value = true
  }
  display.value = 'manual'
}

function buildManualInput() {
  return {
    issuer: issuer.value || null,
    name: name.value,
    secret: secret.value,
    digits: digits.value,
    algorithm: algorithm.value,
    period: period.value,
    touchRequired: touchRequired.value,
  }
}

async function submitManual() {
  error.value = ''
  busy.value = true
  try {
    await accounts.addManual(buildManualInput())
    emit('close')
  } catch (e) {
    if (e instanceof PresenceCancelledError) return
    error.value = describeYkmanError(e)
  } finally {
    busy.value = false
  }
}

function continueFromUri() {
  error.value = ''
  const parsed = parseOtpauthUri(uri.value)
  if (!parsed) {
    error.value = 'Could not read that URI as an OTP account.'
    return
  }
  applyParsedAccount(parsed)
}

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
    ui.setSessionPassword(pendingKey.value.serial, pendingPassword.value)
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

type PasswordResolution = { ok: true; password: string | null } | { ok: false; reason: string }

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
      const cached = ui.sessionPasswordFor(serial)
      if (cached) return { ok: true, password: cached }
      const result = await promptForPassword(serial, keyName)
      if (result === 'skip') return { ok: false, reason: 'Skipped.' }
      return { ok: true, password: result }
    }
  }
}

async function submitManualToAll() {
  error.value = ''
  saveAllBusy.value = true
  const input = buildManualInput()
  const results: SaveAllResult[] = []
  for (const key of keys.keys) {
    const resolution = await resolvePasswordForKey(key.serial, key.name)
    if (!resolution.ok) {
      results.push({ serial: key.serial, name: key.name, status: 'error', message: resolution.reason })
      continue
    }
    try {
      await ykman.oathAddManual(key.serial, input, resolution.password)
      results.push({ serial: key.serial, name: key.name, status: 'ok' })
    } catch (e) {
      results.push({ serial: key.serial, name: key.name, status: 'error', message: describeYkmanError(e) })
    }
  }
  await accounts.refresh()
  saveAllBusy.value = false
  saveAllResults.value = results
}

function finishSaveAll() {
  saveAllResults.value = null
  emit('close')
}

function onQrFileCancelled() {
  // Chromium fires 'cancel' on <input type=file> when the picker is
  // dismissed without a file - without this the sheet would otherwise sit
  // open on a blank QR screen with nothing left to do.
  if (!issuer.value && !secret.value && !name.value) emit('close')
}

async function onQrFileChosen(event: Event) {
  qrError.value = ''
  error.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const decoded = decodeQrFromImageData(imageData)
  if (!decoded) {
    qrError.value = 'No QR code found in that image.'
    return
  }
  const parsed = parseOtpauthUri(decoded)
  if (!parsed) {
    qrError.value = 'Could not read that QR code as an OTP account.'
    return
  }
  applyParsedAccount(parsed)
}

function browseForImage() {
  qrError.value = ''
  qrFileInput.value?.click()
}

onMounted(async () => {
  if (props.mode !== 'qr') return
  await nextTick()
  browseForImage()
})
</script>

<template>
  <FullPageDialog visible title="Add account" :busy="busy || saveAllBusy" @back="emit('close')">
    <div v-if="saveAllResults">
      <ul class="save-all-results" data-test="save-all-results">
        <li v-for="r in saveAllResults" :key="r.serial">
          <span class="key-name">{{ r.name }}</span>
          <span v-if="r.status === 'ok'" class="result-ok">Saved</span>
          <span v-else class="result-error">{{ r.message }}</span>
        </li>
      </ul>
      <button class="btn btn-primary btn-block" data-test="save-all-done" @click="finishSaveAll">Done</button>
    </div>

    <div v-else-if="pendingKey">
      <p>{{ pendingKey.name }} needs its OATH password to save this account.</p>
      <div class="field">
        <label>Password</label>
        <PasswordField data-test="pending-password" v-model="pendingPassword" @keyup.enter="onPendingSubmit" />
      </div>
      <div class="field checkbox-field">
        <ToggleSwitch v-model="pendingRemember" />
        <label>Remember on this device</label>
      </div>
      <p v-if="pendingError" class="field-error">{{ pendingError }}</p>
      <div class="btn-row">
        <button class="btn btn-secondary btn-block" data-test="pending-skip" :disabled="pendingBusy" @click="onPendingSkip">
          Skip
        </button>
        <button class="btn btn-primary btn-block" data-test="pending-submit" :disabled="pendingBusy" @click="onPendingSubmit">
          <LoadingSpinner v-if="pendingBusy" inline :size="14" />
          <template v-else>Unlock</template>
        </button>
      </div>
    </div>

    <div v-else-if="display === 'manual'">
      <div class="field">
        <label>Issuer</label>
        <input data-test="issuer" v-model="issuer" />
      </div>
      <div class="field">
        <label>Secret</label>
        <PasswordField data-test="secret" v-model="secret" />
      </div>
      <div class="field">
        <label>Account</label>
        <input data-test="name" v-model="name" />
      </div>
      <div class="field checkbox-field">
        <ToggleSwitch v-model="touchRequired" />
        <label>Require touch</label>
      </div>

      <button type="button" class="advanced-toggle" @click="showAdvanced = !showAdvanced">
        Advanced <ChevronDown class="chevron" :class="{ open: showAdvanced }" :size="16" />
      </button>
      <div v-if="showAdvanced">
        <div class="field">
          <label>Algorithm</label>
          <select v-model="algorithm">
            <option>SHA1</option><option>SHA256</option><option>SHA512</option>
          </select>
        </div>
        <div class="field">
          <label>Digits</label>
          <select v-model.number="digits"><option :value="6">6</option><option :value="7">7</option><option :value="8">8</option></select>
        </div>
        <div class="field">
          <label>Period (s)</label>
          <input type="number" v-model.number="period" />
        </div>
      </div>

      <p v-if="error" class="field-error">{{ error }}</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-block" data-test="manual-submit" :disabled="busy || saveAllBusy" @click="submitManual">
          <LoadingSpinner v-if="busy" inline :size="14" />
          <template v-else>Save</template>
        </button>
        <button
          v-if="showSaveAll"
          class="btn btn-secondary-solid btn-block"
          data-test="manual-submit-all"
          :disabled="busy || saveAllBusy"
          @click="submitManualToAll"
        >
          <LoadingSpinner v-if="saveAllBusy" inline :size="14" />
          <template v-else>Save to all Keys</template>
        </button>
      </div>
    </div>

    <div v-else-if="display === 'uri'">
      <div class="field">
        <label>otpauth:// URI</label>
        <input data-test="uri-input" v-model="uri" />
      </div>
      <p v-if="error" class="field-error">{{ error }}</p>
      <button class="btn btn-primary btn-block" data-test="uri-submit" @click="continueFromUri">Continue</button>
    </div>

    <div v-else>
      <input
        ref="qrFileInput"
        type="file"
        accept="image/*"
        data-test="qr-file-input"
        class="visually-hidden"
        @change="onQrFileChosen"
        @cancel="onQrFileCancelled"
      />
      <p v-if="qrError" class="field-error">
        {{ qrError }}
        <button type="button" class="retry-link" @click="browseForImage">Choose another image</button>
      </p>
      <p v-else class="status"><LoadingSpinner inline :size="14" /> Waiting for image selection…</p>
    </div>
  </FullPageDialog>
</template>

<style scoped>
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: #f2f2f2;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-top: 28px;
}
.chevron { display: inline-block; transition: transform 0.15s ease; color: #7a7a7a; }
.chevron.open { transform: rotate(180deg); }
.status { display: flex; align-items: center; gap: 6px; margin-top: 12px; color: #7a7a7a; font-size: 13px; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.retry-link {
  display: block;
  margin-top: 8px;
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  text-decoration: underline;
}
.btn-row { display: flex; gap: 10px; margin-top: 28px; }
.btn-row .btn-block { margin-top: 0; width: auto; flex: 1; }
.save-all-results { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.save-all-results li { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
.key-name { color: #f2f2f2; }
.result-ok { color: var(--color-primary); }
.result-error { color: #ff6b6b; }
</style>
