export function remToPx(rem: number): number {
  return Math.round(rem * parseFloat(getComputedStyle(document.documentElement).fontSize))
}
