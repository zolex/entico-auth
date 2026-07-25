<script setup lang="ts">
import { ref, watch } from 'vue'
import DialogTitle from './DialogTitle.vue'
import PasswordField from './PasswordField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import { autofocusSelect } from '../lib/autofocus'

const props = withDefaults(
  defineProps<{
    visible: boolean
    passwordProtected: boolean
    busy?: boolean
    error?: string | null
    title?: string
    hideKey?: boolean
  }>(),
  {
    busy: false,
    error: null,
    title: 'Unlock',
    hideKey: false,
  },
)
const emit = defineEmits<{ submit: [password: string, remember: boolean] }>()

const password = ref('')
const remember = ref(false)
const passwordFieldRef = ref<InstanceType<typeof PasswordField> | null>(null)
const continueBtnRef = ref<HTMLButtonElement | null>(null)

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    autofocusSelect(props.passwordProtected ? passwordFieldRef : continueBtnRef)
  },
)

function submit() {
  emit('submit', password.value, remember.value)
  password.value = ''
}
</script>

<template>
  <Transition name="zoom">
    <div class="page-dialog" v-if="visible">
      <div class="page-dialog-header">
        <DialogTitle :title="props.title" :hide-key="props.hideKey" />
      </div>
      <div class="page-dialog-body">
        <template v-if="passwordProtected">
          <p>Enter your OATH password</p>
          <div class="field">
            <PasswordField ref="passwordFieldRef" tabindex="1" v-model="password" @keyup.enter="submit" />
          </div>
          <div class="field checkbox-field">
            <ToggleSwitch tabindex="2" v-model="remember" />
            <label>Remember on this device</label>
          </div>
          <p v-if="error" class="field-error">{{ error }}</p>
          <button class="btn btn-primary btn-block" tabindex="3" :disabled="busy" @click="submit">
            <LoadingSpinner v-if="busy" inline :size="14" />
            <template v-else>Unlock</template>
          </button>
        </template>
        <template v-else>
          <p>No password set for this key.</p>
          <button ref="continueBtnRef" class="btn btn-primary btn-block" tabindex="1" :disabled="busy" @click="emit('submit', '', false)">
            <LoadingSpinner v-if="busy" inline :size="14" />
            <template v-else>Continue</template>
          </button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.zoom-enter-active,
.zoom-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.zoom-enter-from,
.zoom-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
