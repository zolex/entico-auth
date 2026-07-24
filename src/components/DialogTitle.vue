<script setup lang="ts">
import { computed } from 'vue'
import { KeyRound } from '@lucide/vue'
import { useKeysStore } from '../stores/keys'

const props = withDefaults(defineProps<{ title: string; hideKey?: boolean }>(), { hideKey: false })

const keys = useKeysStore()
const activeKey = computed(() => (props.hideKey ? null : keys.keys.find((k) => k.serial === keys.activeSerial)))
</script>

<template>
  <div class="dialog-title">
    <template v-if="activeKey">
      <div class="key-info">
        <div class="key-badge"><KeyRound :size="13" /></div>
        <div>
          <p class="key-name">{{ activeKey.name }}</p>
          <p class="serial">Serial {{ activeKey.serial }}</p>
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
