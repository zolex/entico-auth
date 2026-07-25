<script setup lang="ts">
import { computed } from 'vue'
import { KeyRound } from '@lucide/vue'
import { useKeysStore } from '../stores/keys'
import type { YubiKeyInfo } from '../lib/types'

const props = withDefaults(defineProps<{ title: string; hideKey?: boolean; keys?: YubiKeyInfo[] }>(), {
  hideKey: false,
})

const keysStore = useKeysStore()
const activeKey = computed(() => keysStore.keys.find((k) => k.serial === keysStore.activeSerial))
// `keys` overrides the default single-active-key lookup - used when a dialog
// targets a specific set of keys (e.g. save-to-missing-keys) rather than
// whichever key happens to be active right now.
const displayKeys = computed<YubiKeyInfo[]>(() => {
  if (props.hideKey) return []
  if (props.keys) return props.keys
  return activeKey.value ? [activeKey.value] : []
})
</script>

<template>
  <div class="dialog-title">
    <template v-for="k in displayKeys" :key="k.serial">
      <div class="key-info">
        <div class="key-badge"><KeyRound :size="13" /></div>
        <div>
          <p class="key-name">{{ k.name }}</p>
          <p class="serial">Serial {{ k.serial }}</p>
        </div>
      </div>
      <div class="title-divider" />
    </template>
    <h1>{{ title }}</h1>
  </div>
</template>

<style scoped>
.dialog-title {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.key-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.key-badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #202020;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.key-name { margin: 0; font-size: 13px; font-weight: 600; color: #f2f2f2; }
.serial { margin: 2px 0 0; font-size: 12px; color: #7a7a7a; }
.title-divider {
  width: 1px;
  align-self: stretch;
  min-height: 28px;
  background: #2a2a2a;
  flex-shrink: 0;
}
h1 { margin: 0; font-size: 19px; font-weight: 600; color: #f2f2f2; }
</style>
