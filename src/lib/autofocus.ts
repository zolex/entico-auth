import { nextTick, type Ref } from 'vue'

export interface Focusable {
  focus: () => void
  select?: () => void
}

// Takes the ref itself (not ref.value!) and only reads .value after
// nextTick resolves - a v-if-gated target (e.g. inside FullPageDialog) is
// still null/stale at the moment a 'pre'-flush watcher fires, since that
// runs before the child re-renders to actually mount it. Reading .value
// eagerly at the call site would capture that stale null and silently
// no-op. Selects the whole value too when the target supports it (a real
// text input) - a no-op for anything else (buttons, toggles).
export async function autofocusSelect(ref: Ref<Focusable | null | undefined>) {
  await nextTick()
  ref.value?.focus()
  ref.value?.select?.()
}
