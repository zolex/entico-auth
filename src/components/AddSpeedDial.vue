<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { Keyboard, Link, Image, Plus } from '@lucide/vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ pick: ['manual' | 'uri' | 'qr']; 'update:open': [boolean] }>()

function toggle() {
  emit('update:open', !props.open)
}

function pick(mode: 'manual' | 'uri' | 'qr') {
  emit('update:open', false)
  emit('pick', mode)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('update:open', false)
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="backdrop" v-if="open" @click="emit('update:open', false)" />
  <div class="speed-dial">
    <Transition name="dial-stagger">
      <div class="dial-items" v-if="open">
        <button class="dial-item" data-test="speed-dial-manual" @click="pick('manual')">
          <span class="dial-label">Add manually</span>
          <span class="dial-icon"><Keyboard :size="18" /></span>
        </button>
        <button class="dial-item" data-test="speed-dial-uri" @click="pick('uri')">
          <span class="dial-label">Paste URI</span>
          <span class="dial-icon"><Link :size="18" /></span>
        </button>
        <button class="dial-item" data-test="speed-dial-qr" @click="pick('qr')">
          <span class="dial-label">Import QR Code</span>
          <span class="dial-icon"><Image :size="18" /></span>
        </button>
      </div>
    </Transition>
    <button class="fab" data-test="speed-dial-toggle" @click="toggle">
      <Plus class="fab-icon" :class="{ open }" :size="24" />
    </button>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  top: var(--titlebar-h);
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 24;
}
.speed-dial {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}
.fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-primary-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}
.fab-icon {
  display: inline-block;
  transition: transform 0.15s ease;
}
.fab-icon.open {
  transform: rotate(45deg);
}
.dial-items {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}
.dial-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.dial-label {
  background: #f2f2f2;
  color: #0a0a0a;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}
.dial-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f2f2f2;
  color: #0a0a0a;
  border-radius: 50%;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.dial-stagger-enter-active,
.dial-stagger-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dial-stagger-enter-from,
.dial-stagger-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
