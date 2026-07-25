<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { ArrowLeft } from '@lucide/vue'
import DialogTitle from './DialogTitle.vue'
import type { YubiKeyInfo } from '../lib/types'

const props = withDefaults(
  defineProps<{ visible: boolean; title: string; busy?: boolean; hideKey?: boolean; keys?: YubiKeyInfo[] }>(),
  { busy: false, hideKey: false },
)
const emit = defineEmits<{ back: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible && !props.busy) emit('back')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
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
