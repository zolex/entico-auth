<script setup lang="ts">
defineProps<{ kind: 'ykman-missing' | 'no-key' | 'select-key' | 'oath-disabled' }>()
defineEmits<{ 'open-settings': [] }>()
</script>

<template>
  <div class="empty">
    <template v-if="kind === 'ykman-missing'">
      <svg class="empty-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M9 10V7a3 3 0 0 1 6 0v3" />
        <path d="M12 14v2" />
      </svg>
      <h2 class="empty-title">YubiKey Manager isn't installed</h2>
      <p class="empty-desc">
        Entico Auth reads codes straight off your YubiKey using Yubico's official
        command-line tool - nothing is ever stored on this computer.<br/>
        <a href="https://developers.yubico.com/yubikey-manager/Releases/" target="_blank" rel="noopener">
          Download ykman from the official page</a><br/>
          Then install it and if it does not get auto-detected, open Settings to point Entico Auth at it.
      </p>
      <button class="btn btn-primary" @click="$emit('open-settings')">Open Settings</button>
    </template>
    <template v-else-if="kind === 'no-key'">
      <p>Plug in a YubiKey to get started.</p>
    </template>
    <template v-else-if="kind === 'select-key'">
      <p>Select a YubiKey to get started.</p>
    </template>
    <template v-else>
      <p>The OATH application is disabled on this YubiKey. Enable it with `ykman config usb --enable OATH`, then reconnect the key.</p>
    </template>
  </div>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; padding: 24px; color: #7a7a7a; gap: 12px; }
a { color: var(--color-primary); }
.empty-icon { color: #4a4a4a; margin-bottom: 4px; }
.empty-title { margin: 0; font-size: 18px; font-weight: 600; color: #f2f2f2; }
.empty-desc { max-width: 360px; line-height: 1.5; margin: 0; }
.empty-desc a { font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.empty-desc a:hover { color: var(--color-primary-hover); }
.empty button { margin-top: 8px; }
</style>
