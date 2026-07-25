// Tracks which FullPageDialog instance is topmost, across the whole app -
// module scope (not per-component-instance) is the point: FullPageDialog
// instances nest and never unmount, only toggle `visible`, so more than one
// can be live at once and Escape must only reach the topmost one.
const stack: symbol[] = []

export function pushDialog(id: symbol) {
  if (!stack.includes(id)) stack.push(id)
}

export function popDialog(id: symbol) {
  const idx = stack.indexOf(id)
  if (idx !== -1) stack.splice(idx, 1)
}

export function isTopDialog(id: symbol) {
  return stack[stack.length - 1] === id
}
