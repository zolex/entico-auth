<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{ modelValue: boolean; disabled?: boolean }>(), { disabled: false })
defineEmits<{ 'update:modelValue': [value: boolean] }>()

const buttonRef = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => buttonRef.value?.focus() })
</script>

<template>
  <button
    ref="buttonRef"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    class="toggle-switch"
    :class="{ on: modelValue }"
    :disabled="disabled"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="thumb" />
  </button>
</template>

<style scoped>
.toggle-switch {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: #2a2a2a;
  border: none;
  padding: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  transition: background-color 0.15s ease;
}
.toggle-switch.on { background: var(--color-primary); }
.toggle-switch:disabled { cursor: default; }
.thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.15s ease;
}
.toggle-switch.on .thumb { transform: translateX(18px); }
</style>
