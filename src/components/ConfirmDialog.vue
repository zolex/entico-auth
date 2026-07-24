<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import DialogTitle from './DialogTitle.vue'
import LoadingSpinner from './LoadingSpinner.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    message: string
    emphasis?: string
    detail?: string
    busy?: boolean
    error?: string | null
  }>(),
  { emphasis: '', detail: '', busy: false, error: null },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible && !props.busy) emit('cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition name="sheet">
    <div class="overlay" v-if="visible" @click.self="!busy && emit('cancel')">
      <div class="dialog">
        <DialogTitle :title="message" />
        <p v-if="emphasis" class="emphasis">{{ emphasis }}</p>
        <p v-if="detail" class="detail">{{ detail }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button class="btn btn-danger btn-block" data-test="confirm-danger" :disabled="busy" @click="emit('confirm')">
            <LoadingSpinner v-if="busy" inline :size="14" />
            <template v-else>Delete</template>
          </button>
          <button class="btn btn-cancel btn-block" data-test="cancel" :disabled="busy" @click="emit('cancel')">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  top: var(--titlebar-h);
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 28px;
}
.dialog {
  background: #161616;
  border-radius: 16px;
  padding: 26px 24px;
  color: #f2f2f2;
  width: min(420px, calc(100% - 32px));
  box-sizing: border-box;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.detail { color: #a3a3a3; margin-top: 10px; text-align: center; }
.actions { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
.actions .btn-block { margin-top: 0; }
.error { color: #ff6b6b; margin-top: 12px; }
.emphasis { font-size: 15px; font-weight: 700; margin-top: 20px; margin-bottom: 6px; text-align: center; }
.btn-cancel { background: #2a2a2a; color: #f2f2f2; }
.btn-cancel:hover:not(:disabled) { background: #333333; }

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.25s ease;
}
.sheet-enter-active .dialog,
.sheet-leave-active .dialog {
  transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .dialog,
.sheet-leave-to .dialog {
  transform: translateY(100%);
}
</style>
