<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { DisplayAccount } from '../stores/accounts'
import { nextBoundaryMs, progressFraction, phaseColor } from '../lib/totp-timing'
import { brandIconFor, monogramFor } from '../lib/icons'

const props = defineProps<{ account: DisplayAccount }>()
const emit = defineEmits<{ copy: [code: string]; reveal: [query: string]; contextmenu: [query: string, x: number, y: number] }>()

const icon = computed(() => brandIconFor(props.account.issuer))
const monogram = computed(() => monogramFor(props.account.issuer ?? props.account.name))

const formattedCode = computed(() => {
  const c = props.account.code
  if (!c) return ''
  const mid = Math.ceil(c.length / 2)
  return `${c.slice(0, mid)} ${c.slice(mid)}`
})

const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null

// The store only learns a new code once its async refresh resolves, which
// lags slightly behind the wall-clock period boundary this timer bar ticks
// on - without this, a card would keep showing the previous period's code
// for a moment after the bar had already wrapped back around.
let nextBoundary = nextBoundaryMs(now.value, props.account.period)
const suppressCode = ref(false)

onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now()
    if (now.value >= nextBoundary) {
      nextBoundary = nextBoundaryMs(now.value, props.account.period)
      suppressCode.value = true
    }
  }, 250)
})
onUnmounted(() => {
  if (tick) clearInterval(tick)
})

watch(
  () => props.account.code,
  () => {
    suppressCode.value = false
  },
)

const progress = computed(() => progressFraction(now.value, props.account.period))
const barColor = computed(() => phaseColor(progress.value))
const showCode = computed(() => props.account.code && !suppressCode.value)

function onClick() {
  if (props.account.code) {
    // suppressCode only guards against copying a code that's about to roll
    // over at a period boundary - it has nothing to do with the reveal path
    // below, which never has a code to begin with.
    if (suppressCode.value) return
    emit('copy', props.account.code)
  } else if (props.account.touchRequired) {
    emit('reveal', props.account.query)
  }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  emit('contextmenu', props.account.query, e.clientX, e.clientY)
}
</script>

<template>
  <div class="yb-card" @click="onClick" @contextmenu="onContextMenu">
    <div
      class="timerbar"
      :style="{ width: `${progress * 100}%`, background: barColor }"
      v-if="showCode"
    />
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
    <div class="code" v-if="showCode">{{ formattedCode }}</div>
    <div class="code tap-to-reveal" v-else-if="account.touchRequired">Tap to reveal</div>
    <div class="code" v-else>&nbsp;</div>
  </div>
</template>

<style scoped>
.yb-card {
  position: relative;
  overflow: hidden;
  background: #161616;
  border-radius: 8px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  min-height: 96px;
  cursor: pointer;
}
.timerbar {
  position: absolute;
  top: 0;
  left: 0;
  height: 3px;
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
.code {
  margin-top: auto;
  padding-top: 16px;
  color: #ffffff;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 1.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tap-to-reveal {
  font-size: 15px;
  color: #7a7a7a;
  font-weight: 500;
}
</style>
