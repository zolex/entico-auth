<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { ArrowLeft } from '@lucide/vue'
import DialogTitle from './DialogTitle.vue'
import type { YubiKeyInfo } from '../lib/types'
import { pushDialog, popDialog, isTopDialog } from '../lib/dialogStack'

const props = withDefaults(
  defineProps<{ visible: boolean; title: string; busy?: boolean; hideKey?: boolean; keys?: YubiKeyInfo[] }>(),
  { busy: false, hideKey: false },
)
const emit = defineEmits<{ back: [] }>()

// FullPageDialog instances nest (e.g. AddAccountSheet opened from within
// OathDiffView) and never unmount, only toggle `visible` - so more than one
// instance's Escape listener can be live at once. dialogStack tracks which
// one is currently on top, so Escape only ever closes that one, matching the
// back-arrow button (only the topmost one is reachable/visible).
const id = Symbol()

watch(
  () => props.visible,
  (visible) => (visible ? pushDialog(id) : popDialog(id)),
  { immediate: true },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible && !props.busy && isTopDialog(id)) emit('back')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  popDialog(id)
})
</script>

<template>
  <Transition name="zoom" appear>
    <div class="page-dialog" v-if="visible">
      <div class="page-dialog-header">
        <button class="page-dialog-back" data-test="back" :disabled="busy" @click="emit('back')"><ArrowLeft :size="20" /></button>
        <DialogTitle :title="title" :hide-key="hideKey" :keys="keys" />
      </div>
      <div class="page-dialog-body">
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.zoom-enter-active,
.zoom-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.zoom-enter-from,
.zoom-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
