export function nextBoundaryMs(nowMs: number, periodSeconds: number): number {
  const periodMs = periodSeconds * 1000
  return Math.ceil(nowMs / periodMs) * periodMs
}

export function progressFraction(nowMs: number, periodSeconds: number): number {
  const periodMs = periodSeconds * 1000
  let timeRemaining = nextBoundaryMs(nowMs, periodSeconds) - nowMs

  // If we're exactly on a boundary, the next one is a full period away
  if (timeRemaining === 0) {
    timeRemaining = periodMs
  }

  return Math.max(0, Math.min(1, timeRemaining / periodMs))
}

export function phaseColor(progress: number): string {
  return progress > 0.5 ? 'var(--color-primary)' : 'var(--color-secondary)'
}
