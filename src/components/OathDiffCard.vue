<script setup lang="ts">
import { computed } from 'vue'
import type { MismatchedAccount } from '../lib/oathDiff'
import { brandIconFor, monogramFor } from '../lib/icons'

const props = defineProps<{ account: MismatchedAccount }>()
const emit = defineEmits<{ contextmenu: [query: string, x: number, y: number] }>()

const icon = computed(() => brandIconFor(props.account.issuer))
const monogram = computed(() => monogramFor(props.account.issuer ?? props.account.name))

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  emit('contextmenu', props.account.query, e.clientX, e.clientY)
}
</script>

<template>
  <div class="yb-card" @contextmenu="onContextMenu">
    <div class="yb-card-top">
      <div class="yb-card-text">
        <div class="name">{{ account.issuer ?? account.name }}</div>
        <div class="sub" v-if="account.issuer">{{ account.name }}</div>
      </div>
      <div class="yb-card-icon" :style="icon ? { color: `#${icon.hex}` } : {}">
        <svg v-if="icon" viewBox="0 0 24 24" width="24" height="24"><path :d="icon.path" fill="currentColor" /></svg>
        <span v-else>{{ monogram }}</span>
      </div>
    </div>
    <div class="missing">Missing on: {{ account.missingFrom.map((k) => k.keyName).join(', ') }}</div>
  </div>
</template>

<style scoped>
.yb-card {
  position: relative;
  background: #161616;
  border-radius: 8px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  min-height: 96px;
}
.yb-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.yb-card-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: #f2f2f2;
}
.yb-card-icon svg {
  width: 100%;
  height: 100%;
}
.name {
  color: #f2f2f2;
  font-size: 18px;
  font-weight: 600;
}
.sub {
  color: #7a7a7a;
  font-size: 13px;
  margin-top: 4px;
}
.missing {
  margin-top: auto;
  padding-top: 16px;
  color: #e0a030;
  font-size: 13px;
}
</style>
