// On Windows, clicking or dragging any `data-tauri-drag-region` element
// (our custom title bar, and - for an undecorated window - its resize
// borders) makes Tauri report a spurious focus-lost/focus-regained pair,
// even for a plain click with no actual drag (see tauri-apps/tauri#10767).
// A genuine backgrounding (alt-tab, minimize, tray-hide) stays lost far
// longer than that blip, so delaying the "lost focus" edge briefly - and
// cancelling the delay if focus returns first - filters the spurious case
// out without adding a perceptible delay to real pause/resume behavior.
const DEFAULT_DEBOUNCE_MS = 250

export function debounceFocusLoss(onChange: (focused: boolean) => void, delayMs = DEFAULT_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (focused: boolean) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (focused) {
      onChange(true)
    } else {
      timer = setTimeout(() => {
        timer = null
        onChange(false)
      }, delayMs)
    }
  }
}
