<script setup lang="ts">
import { computed } from 'vue'
import type { DisplayAccount } from '../stores/accounts'
import AccountCard from './AccountCard.vue'

const props = defineProps<{ accounts: DisplayAccount[]; searchQuery: string }>()
const emit = defineEmits<{
  copy: [code: string]
  reveal: [query: string]
  contextmenu: [query: string, x: number, y: number]
}>()

function normalize(s: string): string {
  return s.toLowerCase()
}

const filtered = computed(() => {
  const q = normalize(props.searchQuery.trim())
  if (!q) return props.accounts
  return props.accounts.filter((a) => {
    const haystack = normalize(`${a.issuer ?? ''} ${a.name}`)
    return haystack.includes(q)
  })
})
</script>

<template>
  <div class="yb-cards">
    <AccountCard
      v-for="a in filtered"
      :key="a.query"
      :account="a"
      @copy="(code) => emit('copy', code)"
      @reveal="(q) => emit('reveal', q)"
      @contextmenu="(q, x, y) => emit('contextmenu', q, x, y)"
    />
  </div>
</template>

<style scoped>
.yb-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  align-items: stretch;
  padding: 12px;
}
</style>
