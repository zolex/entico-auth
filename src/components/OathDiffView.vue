<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Plus, Pencil } from '@lucide/vue'
import { useKeysStore } from '../stores/keys'
import { useUiStore } from '../stores/ui'
import { ykman, describeYkmanError } from '../lib/ykman-client'
import { resolveOathStatus } from '../lib/oathStatusResolver'
import { computeOathDiff, type KeyAccounts, type MismatchedAccount, type MissingFromKey } from '../lib/oathDiff'
import FullPageDialog from './FullPageDialog.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import UnlockDialog from './UnlockDialog.vue'
import OathDiffCard from './OathDiffCard.vue'
import AddAccountSheet from './AddAccountSheet.vue'
import RenameDialog from './RenameDialog.vue'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const keys = useKeysStore()
const ui = useUiStore()

const loading = ref(false)
const mismatched = ref<MismatchedAccount[]>([])
const skipped = ref<MissingFromKey[]>([])

const contextMenu = ref<{ visible: boolean; query: string; x: number; y: number }>({
  visible: false,
  query: '',
  x: 0,
  y: 0,
})
const addTarget = ref<MismatchedAccount | null>(null)
const renameTarget = ref<MismatchedAccount | null>(null)

// Looked up live (not just at click time) so the "Rename" menu item's
// v-if can react to which account is currently right-clicked.
const contextAccount = computed(() => mismatched.value.find((m) => m.query === contextMenu.value.query) ?? null)

onMounted(() => window.addEventListener('click', closeContextMenu))
onUnmounted(() => window.removeEventListener('click', closeContextMenu))

function onCardContextMenu(query: string, x: number, y: number) {
  contextMenu.value = { visible: true, query, x, y }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function openAddToMissing() {
  const account = contextAccount.value
  closeContextMenu()
  if (account) addTarget.value = account
}

function openRename() {
  const account = contextAccount.value
  closeContextMenu()
  if (account) renameTarget.value = account
}

function onAddClose() {
  addTarget.value = null
  run()
}

function onRenameClose() {
  renameTarget.value = null
  run()
}

// A locked key still needs a password prompt of its own before it can be
// read - this drives that inline, one key at a time, reusing the same
// UnlockDialog the rest of the app uses (no cancel, matching its existing
// convention).
const unlockTarget = ref<MissingFromKey | null>(null)
const unlockBusy = ref(false)
const unlockError = ref<string | null>(null)
let unlockSubmitted: ((password: string, remember: boolean) => void) | null = null

watch(
  () => props.visible,
  (visible) => {
    if (visible) run()
  },
)

async function run() {
  loading.value = true
  mismatched.value = []
  skipped.value = []
  const collected: KeyAccounts[] = []
  for (const k of keys.keys) {
    const password = await resolvePassword(k.serial, k.name)
    if (password === undefined) {
      skipped.value.push({ serial: k.serial, keyName: k.name })
      continue
    }
    try {
      const accounts = await ykman.oathListAccounts(k.serial, password)
      collected.push({ serial: k.serial, keyName: k.name, accounts })
    } catch {
      skipped.value.push({ serial: k.serial, keyName: k.name })
    }
  }
  mismatched.value = computeOathDiff(collected)
  loading.value = false
}

// Resolves the password to read `serial` with. Returns null for an
// unprotected/remembered key, undefined when the key can't be read at all
// (oath disabled or a persistent failure).
async function resolvePassword(serial: string, keyName: string): Promise<string | null | undefined> {
  const outcome = await resolveOathStatus(serial, ykman)
  switch (outcome.kind) {
    case 'unprotected':
    case 'remembered':
      return null
    case 'locked':
      return ui.sessionPasswordFor(serial) ?? (await promptUnlock(serial, keyName))
    case 'oath-disabled':
    case 'unknown':
      return undefined
  }
}

function promptUnlock(serial: string, keyName: string): Promise<string | undefined> {
  unlockTarget.value = { serial, keyName }
  unlockError.value = null
  return new Promise((resolve) => {
    unlockSubmitted = async (password, remember) => {
      unlockBusy.value = true
      unlockError.value = null
      try {
        await ykman.oathUnlock(serial, password, remember)
        ui.setSessionPassword(serial, password)
        unlockTarget.value = null
        resolve(password)
      } catch (e) {
        unlockError.value = describeYkmanError(e)
      } finally {
        unlockBusy.value = false
      }
    }
  })
}

function onUnlockSubmit(password: string, remember: boolean) {
  unlockSubmitted?.(password, remember)
}
</script>

<template>
  <FullPageDialog :visible="visible" title="OATH Diff" hide-key @back="emit('close')">
    <LoadingSpinner v-if="loading" />
    <template v-else>
      <p v-if="skipped.length" class="skip-note">
        Couldn't read {{ skipped.map((s) => s.keyName).join(', ') }} — diff may be incomplete.
      </p>
      <p v-if="!mismatched.length" class="empty-note">All accounts present on every key.</p>
      <div v-else class="yb-cards">
        <OathDiffCard v-for="m in mismatched" :key="m.query" :account="m" @contextmenu="onCardContextMenu" />
      </div>

      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button @click="openAddToMissing"><Plus :size="15" /> Add to missing keys</button>
        <button v-if="contextAccount && contextAccount.presentFrom.length > 0" @click="openRename">
          <Pencil :size="15" /> Rename
        </button>
      </div>

      <AddAccountSheet
        v-if="addTarget"
        :prefill="{ issuer: addTarget.issuer, name: addTarget.name, period: addTarget.period, touchRequired: addTarget.touchRequired }"
        :missing-keys="addTarget.missingFrom.map((m) => ({ serial: m.serial, name: m.keyName }))"
        @close="onAddClose"
      />

      <RenameDialog
        v-if="renameTarget"
        visible
        :issuer="renameTarget.issuer ?? ''"
        :name="renameTarget.name"
        :query="renameTarget.query"
        :selected-keys="renameTarget.presentFrom.map((m) => ({ serial: m.serial, name: m.keyName }))"
        @cancel="onRenameClose"
        @close="onRenameClose"
      />
    </template>

    <UnlockDialog
      :visible="unlockTarget !== null"
      :password-protected="true"
      :busy="unlockBusy"
      :error="unlockError"
      :keys="unlockTarget ? [{ serial: unlockTarget.serial, name: unlockTarget.keyName }] : []"
      @submit="onUnlockSubmit"
    />
  </FullPageDialog>
</template>

<style scoped>
.yb-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  align-items: stretch;
}
.skip-note {
  color: #e0a030;
  font-size: 13px;
  margin: 0 0 16px;
}
.empty-note {
  color: #7a7a7a;
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
</style>
