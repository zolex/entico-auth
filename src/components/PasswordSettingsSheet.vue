<script setup lang="ts">
import { ref, watch } from 'vue'
import { useKeysStore } from '../stores/keys'
import { useUiStore } from '../stores/ui'
import { ykman, describeYkmanError } from '../lib/ykman-client'
import { PresenceCancelledError } from '../lib/presence'
import LoadingSpinner from './LoadingSpinner.vue'
import FullPageDialog from './FullPageDialog.vue'
import PasswordField from './PasswordField.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const props = defineProps<{ visible: boolean; passwordProtected: boolean }>()
const emit = defineEmits<{ close: []; changed: []; success: [message: string] }>()

const keys = useKeysStore()
const ui = useUiStore()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const remember = ref(false)
const rememberTouched = ref(false)
const error = ref('')
const busy = ref(false)

// Reset the form whenever the sheet is (re-)opened, mirroring RenameDialog/UnlockDialog.
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      remember.value = false
      rememberTouched.value = false
      error.value = ''
    }
  },
)

function onRememberChange() {
  rememberTouched.value = true
}

async function save() {
  const serial = keys.activeSerial
  if (!serial) return
  error.value = ''
  if (newPassword.value && newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  busy.value = true
  try {
    let message: string
    if (newPassword.value) {
      // Setting a password for the first time, or changing the existing one.
      await ykman.oathSetPassword(
        serial,
        props.passwordProtected ? currentPassword.value : null,
        newPassword.value,
        remember.value,
      )
      message = props.passwordProtected ? 'Password changed.' : 'Password set.'
      if (remember.value) {
        // ykman itself now remembers this password (passed -r above) - rely
        // on that instead of holding it ourselves, exactly like the
        // 'remembered' outcome from oath info on unlock.
        ui.clearSessionPassword(serial)
      } else {
        // Not remembered by ykman: the session's own reads/writes need the
        // password explicitly on every ykman call (see run_ykman) or they'd
        // hit the interactive-prompt hang, so keep it in sync ourselves.
        ui.setSessionPassword(serial, newPassword.value)
      }
    } else if (props.passwordProtected && rememberTouched.value) {
      // No new password entered, but the remember-on-this-device checkbox was
      // explicitly touched: apply it against the existing password. If the
      // user opened the sheet and clicked Save without touching anything,
      // rememberTouched stays false and we fall through below - otherwise
      // this would silently forget the device password every time.
      if (remember.value) {
        await ykman.oathRememberPassword(serial, currentPassword.value)
        message = 'Remembered on this device.'
        ui.clearSessionPassword(serial)
      } else {
        await ykman.oathForgetPassword(serial)
        message = 'Forgot the remembered password on this device.'
        ui.setSessionPassword(serial, currentPassword.value)
      }
    } else if (props.passwordProtected && currentPassword.value) {
      // Blank new password with the current password filled in and the
      // remember checkbox untouched: the user's intent is to remove the
      // password (the new-password field's label spells this out).
      await ykman.oathClearPassword(serial, currentPassword.value)
      message = 'Password removed.'
      ui.clearSessionPassword(serial)
    } else {
      return
    }
    emit('changed')
    emit('success', message)
    emit('close')
  } catch (e) {
    if (e instanceof PresenceCancelledError) return
    error.value = describeYkmanError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FullPageDialog :visible="visible" title="OATH password" :busy="busy" @back="emit('close')">
    <div class="field" v-if="passwordProtected">
      <label>Current password</label>
      <PasswordField data-test="current-password" v-model="currentPassword" />
    </div>

    <div class="field">
      <label>{{ passwordProtected ? 'New password (leave blank to remove)' : 'Set a password' }}</label>
      <PasswordField data-test="new-password" v-model="newPassword" />
    </div>

    <div class="field">
      <label>Confirm new password</label>
      <PasswordField data-test="confirm-password" v-model="confirmPassword" />
    </div>

    <div class="field checkbox-field">
      <ToggleSwitch data-test="remember" :model-value="remember" @update:model-value="(v) => { remember = v; onRememberChange() }" />
      <label>Remember on this device</label>
    </div>

    <p v-if="error" class="field-error">{{ error }}</p>

    <button class="btn btn-primary btn-block" data-test="save" :disabled="busy" @click="save">
      <LoadingSpinner v-if="busy" inline :size="14" />
      <template v-else>Save</template>
    </button>
  </FullPageDialog>
</template>
