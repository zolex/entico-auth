<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getVersionLabel } from '../lib/version'
import FullPageDialog from './FullPageDialog.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const versionLabel = ref('')
onMounted(() => {
  getVersionLabel().then((v) => (versionLabel.value = v))
})

function open(url: string) {
  openUrl(url)
}
</script>

<template>
  <FullPageDialog :visible="visible" title="About" hide-key @back="emit('close')">
    <div class="about-hero">
      <h2>Entico Auth</h2>
      <p v-if="versionLabel" class="version">{{ versionLabel }}</p>
    </div>

    <p class="lead">
      A focused window onto the TOTP accounts stored on your YubiKey's OATH application, styled
      in the spirit of Ente Auth.
    </p>

    <section class="about-section">
      <h3>How it works</h3>
      <ul>
        <li>Entico Auth does not store any secrets. Every operation shells out to your installed <code>ykman.exe</code>.</li>
        <li>Every code is computed live on the hardware key itself; the app never generates a TOTP code on its own.</li>
        <li>OATH secrets are never stored, cached, or transmitted by this app. Only non-sensitive
          settings (e.g. window position or autostart) are saved locally on your machine.</li>
        <li>A password you type to unlock a protected key is kept in memory only for the current
          session and passed straight through to <code>ykman</code>. "Remember on this device" delegates
          to ykman's own OS-keychain-backed cache.</li>
      </ul>
    </section>

    <section class="about-section">
      <h3>About the author</h3>
      <p>Built by Andreas Linden.</p>
      <button class="link-button" @click="open('https://github.com/zolex')">github.com/zolex</button>
    </section>

    <div class="warning">
      <strong>Use at your own risk.</strong> Entico Auth talks directly to your YubiKey's OATH
      application via <code>ykman</code>. The author accepts no responsibility for any data loss
      on your YubiKey, including accounts removed or overwritten, and being locked out due to
      unknown passwords through this app. Keep your own backups of your account provisioning
      information, for example on a backup YubiKey or in a secure vault like Bitwarden.
    </div>
  </FullPageDialog>
</template>

<style scoped>
.about-hero { display: flex; align-items: baseline; gap: 10px; }
.about-hero h2 { margin: 0; font-size: 20px; }
.version { margin: 0; font-size: 12px; color: #7a7a7a; }
.lead { color: #a3a3a3; margin-top: 14px; line-height: 1.5; }
.about-section { margin-top: 26px; }
.about-section h3 { margin: 0 0 8px; font-size: 13px; color: #7a7a7a; text-transform: uppercase; letter-spacing: 0.05em; }
.about-section p { margin: 0 0 6px; }
.about-section ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; color: #a3a3a3; line-height: 1.5; }
.about-section code { background: #202020; border-radius: 4px; padding: 1px 5px; font-size: 0.9em; }
.link-button {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  text-decoration: underline;
}
.link-button:hover { color: var(--color-primary-hover); }
.warning {
  margin-top: 26px;
  padding: 14px 16px;
  border-radius: 8px;
  background: rgba(224, 160, 48, 0.08);
  border: 1px solid rgba(224, 160, 48, 0.35);
  color: #e0a030;
  font-size: 13px;
  line-height: 1.5;
}
.warning strong { display: block; margin-bottom: 4px; color: #f2f2f2; }
</style>
