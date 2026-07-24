<script setup lang="ts">
import { ref } from 'vue'
import DialogTitle from './DialogTitle.vue'
import PasswordField from './PasswordField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import LoadingSpinner from './LoadingSpinner.vue'

withDefaults(defineProps<{ visible: boolean; passwordProtected: boolean; busy?: boolean; error?: string | null }>(), {
  busy: false,
  error: null,
})
const emit = defineEmits<{ submit: [password: string, remember: boolean] }>()

const password = ref('')
const remember = ref(false)

function submit() {
  emit('submit', password.value, remember.value)
  password.value = ''
}
</script>

<template>
  <Transition name="zoom">
    <div class="page-dialog" v-if="visible">
      <div class="page-dialog-header">
        <DialogTitle title="Unlock" />
      </div>
      <div class="page-dialog-body">
        <template v-if="passwordProtected">
          <p>Enter your OATH password</p>
          <div class="field">
            <PasswordField v-model="password" @keyup.enter="submit" />
          </div>
          <div class="field checkbox-field">
            <ToggleSwitch v-model="remember" />
            <label>Remember on this device</label>
          </div>
          <p v-if="error" class="field-error">{{ error }}</p>
          <button class="btn btn-primary btn-block" :disabled="busy" @click="submit">
            <LoadingSpinner v-if="busy" inline :size="14" />
            <template v-else>Unlock</template>
          </button>
        </template>
        <template v-else>
          <p>No password set for this key.</p>
          <button class="btn btn-primary btn-block" :disabled="busy" @click="emit('submit', '', false)">
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
