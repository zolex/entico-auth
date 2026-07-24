<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Menu, Search, Lock, LockOpen, Minus, Square, X } from '@lucide/vue'

defineProps<{ locked: boolean; canSearch: boolean }>()
const emit = defineEmits<{ toggleMenu: []; toggleSearch: []; toggleLock: [] }>()

const win = getCurrentWindow()
</script>

<template>
  <div class="titlebar" data-tauri-drag-region>
    <button class="icon-btn" @click="emit('toggleMenu')"><Menu :size="18" /></button>
    <div class="title" data-tauri-drag-region>Entico Auth</div>
    <div class="right">
      <button v-if="canSearch" class="icon-btn" @click="emit('toggleSearch')"><Search :size="18" /></button>
      <!-- Hidden for now, not removed. -->
      <button class="icon-btn lock-btn-hidden" @click="emit('toggleLock')">
        <Lock v-if="locked" :size="18" />
        <LockOpen v-else :size="18" />
      </button>
      <button class="icon-btn" @click="win.minimize()"><Minus :size="16" /></button>
      <button class="icon-btn" @click="win.toggleMaximize()"><Square :size="14" /></button>
      <button class="icon-btn" @click="win.close()"><X :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.titlebar { position: relative; display: flex; align-items: center; justify-content: space-between; height: var(--titlebar-h); box-sizing: border-box; padding: 0 12px; background: #0a0a0a; flex-shrink: 0; user-select: none; -webkit-user-select: none; }
.title { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-weight: 600; }
.right { display: flex; gap: 4px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: none; color: #f2f2f2; cursor: pointer; padding: 4px 8px; }
.lock-btn-hidden { display: none; }
</style>
