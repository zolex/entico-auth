<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import LoadingSpinner from './LoadingSpinner.vue'
import FullPageDialog from './FullPageDialog.vue'
import KeyPasswordPrompt from './KeyPasswordPrompt.vue'
import { autofocusSelect } from '../lib/autofocus'
import { useKeyPasswordPrompt } from '../lib/useKeyPasswordPrompt'
import { useKeysStore } from '../stores/keys'
import { useAccountsStore } from '../stores/accounts'
import { useUiStore } from '../stores/ui'
import { ykman, describeYkmanError } from '../lib/ykman-client'
import type { YubiKeyInfo } from '../lib/types'

const props = withDefaults(
  defineProps<{
    visible: boolean
    issuer: string
    name: string
    // Old issuer:name - identifies which account to rename when fanning the
    // rename out across keys (the single-key path below doesn't need this,
    // the parent already tracks it and does the rename itself on submit).
    query?: string
    busy?: boolean
    error?: string | null
    // When set, replaces the normal Save / Rename-on-all-keys buttons with a
    // single "Rename on selected keys" button scoped to just this list -
    // used when opened from the OATH Diff view, where the caller already
    // knows which keys have the account.
    selectedKeys?: YubiKeyInfo[]
  }>(),
  { busy: false, error: null, query: '' },
)
const emit = defineEmits<{
  submit: [newIssuer: string | null, newName: string]
  cancel: []
  // Fired when the user dismisses the rename-all/rename-selected results
  // screen - distinct from `cancel` since by then the rename has already
  // happened and there's nothing left to abort.
  close: []
}>()

const keys = useKeysStore()
const accounts = useAccountsStore()
const ui = useUiStore()

const issuerInput = ref(props.issuer)
const nameInput = ref(props.name)
const issuerInputRef = ref<HTMLInputElement | null>(null)

// Only worth offering once there's more than one connected key to fan out to
// - with a single key it would just duplicate the regular Save button.
const showRenameAll = computed(() => !props.selectedKeys && keys.keys.length > 1)

interface RenameResult {
  serial: string
  name: string
  status: 'ok' | 'skipped' | 'error'
  message?: string
}
const renameAllBusy = ref(false)
const renameAllResults = ref<RenameResult[] | null>(null)
const renameAllDoneBtnRef = ref<HTMLButtonElement | null>(null)

const { pendingKey, pendingPassword, pendingRemember, pendingBusy, pendingError, resolvePasswordForKey, onPendingSubmit, onPendingSkip } =
  useKeyPasswordPrompt()

// The component stays mounted across different accounts (like UnlockDialog/ConfirmDialog),
// so reset the local form fields from props whenever it's (re-)opened.
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      issuerInput.value = props.issuer
      nameInput.value = props.name
      renameAllResults.value = null
      autofocusSelect(issuerInputRef)
    }
  },
)
watch(renameAllResults, (results) => {
  if (results) autofocusSelect(renameAllDoneBtnRef)
})

function submit() {
  if (props.busy) return
  const trimmedName = nameInput.value.trim()
  if (!trimmedName) return
  emit('submit', issuerInput.value.trim() || null, trimmedName)
}

// Renames every connected key that has an account matching the old query -
// unlike submitSelected below, we don't already know which keys have it, so
// each key's accounts are listed first to check before attempting the rename.
async function submitAll() {
  const newName = nameInput.value.trim()
  if (!newName) return
  const newIssuer = issuerInput.value.trim() || null
  renameAllBusy.value = true
  const results: RenameResult[] = []
  for (const key of keys.keys) {
    const resolution = await resolvePasswordForKey(key.serial, key.name)
    if (!resolution.ok) {
      results.push({ serial: key.serial, name: key.name, status: 'error', message: resolution.reason })
      continue
    }
    try {
      const accountsOnKey = await ykman.oathListAccounts(key.serial, resolution.password)
      if (!accountsOnKey.some((a) => a.query === props.query)) {
        results.push({ serial: key.serial, name: key.name, status: 'skipped', message: 'Not present' })
        continue
      }
      await ykman.oathRename(key.serial, props.query, newIssuer, newName, resolution.password)
      results.push({ serial: key.serial, name: key.name, status: 'ok' })
    } catch (e) {
      results.push({ serial: key.serial, name: key.name, status: 'error', message: describeYkmanError(e) })
    }
  }
  await accounts.refresh()
  renameAllBusy.value = false
  renameAllResults.value = results
}

// The caller already knows these keys have the account (they came from an
// OATH Diff scan that just successfully read them), and that scan cached
// each one's password - so no listing/prompting needed here.
async function submitSelected() {
  const newName = nameInput.value.trim()
  if (!newName) return
  const newIssuer = issuerInput.value.trim() || null
  renameAllBusy.value = true
  const results: RenameResult[] = []
  for (const key of props.selectedKeys ?? []) {
    try {
      await ykman.oathRename(key.serial, props.query, newIssuer, newName, ui.sessionPasswordFor(key.serial))
      results.push({ serial: key.serial, name: key.name, status: 'ok' })
    } catch (e) {
      results.push({ serial: key.serial, name: key.name, status: 'error', message: describeYkmanError(e) })
    }
  }
  renameAllBusy.value = false
  renameAllResults.value = results
}

function finishRenameAll() {
  renameAllResults.value = null
  emit('close')
}
</script>

<template>
  <FullPageDialog
    :visible="visible"
    title="Rename account"
    :busy="busy || renameAllBusy || pendingBusy"
    :keys="selectedKeys"
    @back="emit('cancel')"
  >
    <div v-if="renameAllResults">
      <ul class="rename-all-results" data-test="rename-all-results">
        <li v-for="r in renameAllResults" :key="r.serial">
          <span class="key-name">{{ r.name }}</span>
          <span v-if="r.status === 'ok'" class="result-ok">Renamed</span>
          <span v-else-if="r.status === 'skipped'" class="result-skipped">{{ r.message }}</span>
          <span v-else class="result-error">{{ r.message }}</span>
        </li>
      </ul>
      <button ref="renameAllDoneBtnRef" class="btn btn-primary btn-block" data-test="rename-all-done" tabindex="1" @click="finishRenameAll">
        Done
      </button>
    </div>

    <KeyPasswordPrompt
      v-else-if="pendingKey"
      :pending-key="pendingKey"
      v-model:password="pendingPassword"
      v-model:remember="pendingRemember"
      :busy="pendingBusy"
      :error="pendingError"
      verb="rename"
      @submit="onPendingSubmit"
      @skip="onPendingSkip"
    />

    <div v-else>
      <div class="field">
        <label>Issuer</label>
        <input ref="issuerInputRef" data-test="rename-issuer" tabindex="1" v-model="issuerInput" @keyup.enter="submit" />
      </div>
      <div class="field">
        <label>Name</label>
        <input data-test="rename-name" tabindex="2" v-model="nameInput" @keyup.enter="submit" />
      </div>
      <p v-if="error" class="field-error">{{ error }}</p>

      <template v-if="selectedKeys">
        <button
          class="btn btn-primary btn-block"
          data-test="rename-submit-selected"
          tabindex="3"
          :disabled="renameAllBusy"
          @click="submitSelected"
        >
          <LoadingSpinner v-if="renameAllBusy" inline :size="14" />
          <template v-else>Rename on selected keys</template>
        </button>
      </template>
      <div v-else class="btn-row">
        <button class="btn btn-primary btn-block" data-test="rename-submit" tabindex="3" :disabled="busy || renameAllBusy" @click="submit">
          <LoadingSpinner v-if="busy" inline :size="14" />
          <template v-else>Save</template>
        </button>
        <button
          v-if="showRenameAll"
          class="btn btn-secondary-solid btn-block"
          data-test="rename-submit-all"
          tabindex="4"
          :disabled="busy || renameAllBusy"
          @click="submitAll"
        >
          <LoadingSpinner v-if="renameAllBusy" inline :size="14" />
          <template v-else>Rename on all keys</template>
        </button>
      </div>
    </div>
  </FullPageDialog>
</template>

<style scoped>
.btn-row { display: flex; gap: 10px; margin-top: 28px; }
.btn-row .btn-block { margin-top: 0; width: auto; flex: 1; }
@media (min-width: 640px) {
  .btn-row { justify-content: flex-start; }
  .btn-row .btn-block { flex: none; width: fit-content; }
}
.rename-all-results { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.rename-all-results li { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
.key-name { color: #f2f2f2; }
.result-ok { color: var(--color-primary); }
.result-skipped { color: #7a7a7a; }
.result-error { color: #ff6b6b; }
</style>
