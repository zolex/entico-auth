<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { KeyRound, Shield, Settings, Info, GitCompare, Pencil, PlayCircle, LogOut } from '@lucide/vue'
import { getVersionLabel } from '../lib/version'
import { useKeysStore } from '../stores/keys'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  close: []
  openPasswordSettings: []
  openSettings: []
  openAbout: []
  openOathDiff: []
  openRenameKey: []
  toggleDemo: []
}>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) emit('close')
}

const versionLabel = ref('')

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  getVersionLabel().then((v) => (versionLabel.value = v))
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const keys = useKeysStore()
const ui = useUiStore()
</script>

<template>
  <Transition name="backdrop-fade">
    <div class="backdrop" v-if="visible" @click="emit('close')" />
  </Transition>
  <Transition name="menu-slide">
    <div class="menu" v-if="visible">
      <h4>Connected Keys</h4>
      <button
        v-for="k in keys.keys"
        :key="k.serial"
        class="menu-item"
        :class="{ active: k.serial === keys.activeSerial }"
        @click="keys.selectKey(k.serial); emit('close')"
      >
        <span class="menu-icon"><KeyRound :size="16" /></span> {{ k.name }} ({{ k.serial }})
      </button>

      <div class="divider" />

      <button v-if="keys.activeSerial" class="menu-item" @click="emit('openRenameKey'); emit('close')">
        <span class="menu-icon"><Pencil :size="16" /></span> Rename Key
      </button>
      <button v-if="keys.activeSerial" class="menu-item" @click="emit('openPasswordSettings'); emit('close')">
        <span class="menu-icon"><Shield :size="16" /></span> OATH Password
      </button>
      <button v-if="keys.keys.length > 1" class="menu-item" @click="emit('openOathDiff'); emit('close')">
        <span class="menu-icon"><GitCompare :size="16" /></span> OATH Diff
      </button>

      <div class="divider divider-push" />

      <button class="menu-item" @click="emit('toggleDemo'); emit('close')">
        <span class="menu-icon">
          <LogOut v-if="ui.demoMode" :size="16" />
          <PlayCircle v-else :size="16" />
        </span>
        {{ ui.demoMode ? 'Exit Demo' : 'Try Demo' }}
      </button>
      <button class="menu-item" @click="emit('openSettings'); emit('close')">
        <span class="menu-icon"><Settings :size="16" /></span> Settings
      </button>
      <button class="menu-item" @click="emit('openAbout'); emit('close')">
        <span class="menu-icon"><Info :size="16" /></span> About
      </button>

      <div class="version" v-if="versionLabel">{{ versionLabel }}</div>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop {
  position: fixed;
  top: calc(var(--titlebar-h) + var(--demo-banner-h));
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  /* Above .page-dialog (z-index: 30, shared by every full-page dialog): the
     menu can be opened directly from a fullscreen dialog (see toggleMenu in
     App.vue), and that dialog's closing transition keeps it mounted for a
     beat - without outranking it here, the still-fading dialog would sit on
     top of the menu and swallow the first click meant to open it. */
  z-index: 31;
}
.menu {
  position: fixed;
  top: calc(var(--titlebar-h) + var(--demo-banner-h));
  left: 0;
  bottom: 0;
  width: 340px;
  background: #161616;
  color: #f2f2f2;
  z-index: 32;
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  box-shadow: 2px 0 16px rgba(0, 0, 0, 0.4);
  overflow-y: auto;
}
h4 {
  margin: 16px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a7a7a;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: none;
  border: none;
  color: #f2f2f2;
  text-align: left;
  padding: 10px 16px;
  font-size: 14px;
  cursor: pointer;
}
.menu-item:hover {
  background: #202020;
}
.menu-item.active {
  background: var(--color-secondary);
  font-weight: 600;
}
.menu-icon {
  width: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.divider {
  height: 1px;
  background: #2a2a2a;
  margin: 8px 16px;
}
.divider-push {
  margin-top: auto;
}
.version {
  padding: 12px 0 4px;
  text-align: center;
  font-size: 11px;
  color: #4a4a4a;
}

.menu-slide-enter-active,
.menu-slide-leave-active {
  transition: transform 0.2s ease;
}
.menu-slide-enter-from,
.menu-slide-leave-to {
  transform: translateX(-100%);
}
.backdrop-fade-enter-active,
.backdrop-fade-leave-active {
  transition: opacity 0.2s ease;
}
.backdrop-fade-enter-from,
.backdrop-fade-leave-to {
  opacity: 0;
}
</style>
