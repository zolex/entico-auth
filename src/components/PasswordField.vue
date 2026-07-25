<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })
defineProps<{ modelValue: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()

const visible = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select(),
})
</script>

<template>
  <div class="password-field">
    <input
      ref="inputRef"
      v-bind="$attrs"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="eye-btn"
      tabindex="-1"
      :aria-label="visible ? 'Hide password' : 'Show password'"
      @click="visible = !visible"
    >
      <svg v-if="!visible" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.86 21.86 0 0 1 5.06-6.06" />
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a21.9 21.9 0 0 1-3.22 4.44" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <path d="M1 1l22 22" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.password-field { position: relative; }
.password-field input { padding-right: 28px; }
/* WebView2 (Edge/Chromium) draws its own built-in reveal-password eye inside
   the input; without hiding it, it stacks with our custom eye-btn below. */
.password-field input::-ms-reveal,
.password-field input::-ms-clear {
  display: none;
}
.eye-btn {
  position: absolute;
  right: 0;
  bottom: 6px;
  background: none;
  border: none;
  color: #ffffff;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: flex;
}
.eye-btn:hover { opacity: 0.8; }
</style>
