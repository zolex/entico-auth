<script setup lang="ts">
withDefaults(defineProps<{ size?: number; inline?: boolean }>(), {
  size: 32,
  inline: false,
})
</script>

<template>
  <div class="loading" :class="{ inline }">
    <div class="spinner" :style="{ width: `${size}px`, height: `${size}px` }" />
  </div>
</template>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}
.loading.inline {
  display: inline-flex;
  min-height: 0;
}
.spinner {
  border: 3px solid #2a2a2a;
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: yb-spin 0.8s linear infinite;
}
@keyframes yb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
