<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import DialogTitle from './DialogTitle.vue'

const props = defineProps<{ visible: boolean; message: string }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition name="sheet">
    <div class="overlay" v-if="visible" @click.self="emit('close')">
      <div class="dialog">
        <DialogTitle :title="message" />
        <div class="actions">
          <button class="btn btn-primary btn-block" data-test="ok" tabindex="1" @click="emit('close')">OK</button>
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
  z-index: 30;
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
.actions { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
.actions .btn-block { margin-top: 0; }

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
