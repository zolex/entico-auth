<script setup lang="ts">
import { watch, ref } from 'vue'
import LoadingSpinner from './LoadingSpinner.vue'
import PasswordField from './PasswordField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { autofocusSelect } from '../lib/autofocus'

const props = withDefaults(
  defineProps<{
    pendingKey: { serial: string; name: string } | null
    password: string
    remember: boolean
    busy: boolean
    error: string | null
    // What the password is needed for, e.g. "save"/"rename" - fills the
    // "<key> needs its OATH password to <verb> this account." prompt text.
    verb?: string
  }>(),
  { verb: 'save' },
)
const emit = defineEmits<{
  'update:password': [value: string]
  'update:remember': [value: boolean]
  submit: []
  skip: []
}>()

const passwordRef = ref<InstanceType<typeof PasswordField> | null>(null)
watch(
  () => props.pendingKey,
  (key) => {
    if (key) autofocusSelect(passwordRef)
  },
)
</script>

<template>
  <div v-if="pendingKey">
    <p>{{ pendingKey.name }} needs its OATH password to {{ verb }} this account.</p>
    <div class="field">
      <label>Password</label>
      <PasswordField
        ref="passwordRef"
        data-test="pending-password"
        tabindex="1"
        :model-value="password"
        @update:model-value="emit('update:password', $event)"
        @keyup.enter="emit('submit')"
      />
    </div>
    <div class="field checkbox-field">
      <ToggleSwitch tabindex="2" :model-value="remember" @update:model-value="emit('update:remember', $event)" />
      <label>Remember on this device</label>
    </div>
    <p v-if="error" class="field-error">{{ error }}</p>
    <div class="btn-row">
      <button class="btn btn-secondary btn-block" data-test="pending-skip" tabindex="3" :disabled="busy" @click="emit('skip')">
        Skip
      </button>
      <button class="btn btn-primary btn-block" data-test="pending-submit" tabindex="4" :disabled="busy" @click="emit('submit')">
        <LoadingSpinner v-if="busy" inline :size="14" />
        <template v-else>Unlock</template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.btn-row { display: flex; gap: 10px; margin-top: 28px; }
.btn-row .btn-block { margin-top: 0; width: auto; flex: 1; }
@media (min-width: 640px) {
  .btn-row { justify-content: flex-start; }
  .btn-row .btn-block { flex: none; width: fit-content; }
}
</style>
