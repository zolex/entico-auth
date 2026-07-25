<script setup lang="ts">
import { ref, watch } from 'vue'
import { useKeysStore } from '../stores/keys'
import LoadingSpinner from './LoadingSpinner.vue'
import FullPageDialog from './FullPageDialog.vue'
import { autofocusSelect } from '../lib/autofocus'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const keys = useKeysStore()

const nameInput = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    const key = keys.keys.find((k) => k.serial === keys.activeSerial)
    nameInput.value = key?.name ?? ''
    error.value = null
    autofocusSelect(nameInputRef)
  },
)

async function save() {
  const serial = keys.activeSerial
  if (!serial) return
  busy.value = true
  error.value = null
  try {
    await keys.setKeyName(serial, nameInput.value)
    emit('close')
  } catch {
    error.value = 'Something went wrong saving the name.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FullPageDialog :visible="visible" title="Rename key" :busy="busy" @back="emit('close')">
    <div class="field">
      <label>Name</label>
      <input
        ref="nameInputRef"
        data-test="rename-key-name"
        tabindex="1"
        v-model="nameInput"
        placeholder="Device name"
        @keyup.enter="save"
      />
    </div>
    <p v-if="error" class="field-error">{{ error }}</p>
    <button class="btn btn-primary btn-block" data-test="rename-key-submit" tabindex="2" :disabled="busy" @click="save">
      <LoadingSpinner v-if="busy" inline :size="14" />
      <template v-else>Rename</template>
    </button>
  </FullPageDialog>
</template>
