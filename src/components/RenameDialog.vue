<script setup lang="ts">
import { ref, watch } from 'vue'
import LoadingSpinner from './LoadingSpinner.vue'
import FullPageDialog from './FullPageDialog.vue'

const props = withDefaults(
  defineProps<{ visible: boolean; issuer: string; name: string; busy?: boolean; error?: string | null }>(),
  { busy: false, error: null },
)
const emit = defineEmits<{ submit: [newIssuer: string | null, newName: string]; cancel: [] }>()

const issuerInput = ref(props.issuer)
const nameInput = ref(props.name)

// The component stays mounted across different accounts (like UnlockDialog/ConfirmDialog),
// so reset the local form fields from props whenever it's (re-)opened.
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      issuerInput.value = props.issuer
      nameInput.value = props.name
    }
  },
)

function submit() {
  if (props.busy) return
  const trimmedName = nameInput.value.trim()
  if (!trimmedName) return
  emit('submit', issuerInput.value.trim() || null, trimmedName)
}
</script>

<template>
  <FullPageDialog :visible="visible" title="Rename account" :busy="busy" @back="emit('cancel')">
    <div class="field">
      <label>Issuer</label>
      <input data-test="rename-issuer" v-model="issuerInput" @keyup.enter="submit" />
    </div>
    <div class="field">
      <label>Name</label>
      <input data-test="rename-name" v-model="nameInput" @keyup.enter="submit" />
    </div>
    <p v-if="error" class="field-error">{{ error }}</p>
    <button class="btn btn-primary btn-block" data-test="rename-submit" :disabled="busy" @click="submit">
      <LoadingSpinner v-if="busy" inline :size="14" />
      <template v-else>Save</template>
    </button>
  </FullPageDialog>
</template>
