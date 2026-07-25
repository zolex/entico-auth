<script setup lang="ts">
import { computed } from 'vue'
import { KeyRound } from '@lucide/vue'
import { useKeysStore } from '../stores/keys'
import { useUiStore } from '../stores/ui'

withDefaults(defineProps<{ visible: boolean; waiting?: boolean }>(), { waiting: false })

const keys = useKeysStore()
const ui = useUiStore()
const activeKey = computed(() => keys.keys.find((k) => k.serial === keys.activeSerial))
</script>

<template>
  <Transition name="sheet">
    <div class="overlay" v-if="visible">
      <div class="dialog">
        <div class="key-info" v-if="activeKey">
          <div class="key-badge"><KeyRound :size="13" /></div>
          <div>
            <p class="key-name">{{ activeKey.name }}</p>
            <p class="serial">Serial {{ activeKey.serial }}</p>
          </div>
        </div>
        <div class="spinner" :class="{ waiting }" />
        <p>{{ waiting ? 'Getting ready for a fresh code…' : 'Touch your YubiKey…' }}</p>
        <p class="demo-hint" v-if="ui.demoMode">Demo mode: touch is simulated, no key needed.</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.key-info { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; text-align: left; }
.key-badge { width: 28px; height: 28px; border-radius: 50%; background: #202020; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.key-name { margin: 0; font-size: 13px; font-weight: 600; color: #f2f2f2; }
.serial { margin: 2px 0 0; font-size: 12px; color: #7a7a7a; }
.demo-hint { margin: 10px 0 0; font-size: 12px; color: #7a7a7a; }
.overlay {
  position: fixed;
  top: calc(var(--titlebar-h) + var(--demo-banner-h));
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
  padding: 32px 40px;
  text-align: center;
  color: #f2f2f2;
  width: min(420px, calc(100% - 32px));
  box-sizing: border-box;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.spinner {
  width: 24px;
  height: 24px;
  margin: 0 auto 12px;
  border: 3px solid #7a7a7a;
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
/* Distinguishes the brief "getting ready" countdown from the actual "touch
   your key" prompt below it - same dialog shell, easy to mistake for one
   another at a glance otherwise. */
.spinner.waiting {
  border-top-color: #3b82f6;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

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
