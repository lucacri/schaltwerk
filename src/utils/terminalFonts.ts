const PLATFORM_FONTS: Record<string, string[]> = {
  darwin: ['Menlo'],
  win32: ['Consolas'],
  linux: ['DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono', 'Ubuntu Mono'],
}

export function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'darwin'
  if (ua.includes('win')) return 'win32'
  return 'linux'
}

export function buildTerminalFontFamily(custom?: string | null, platform?: string): string {
  const resolved = platform ?? detectPlatform()
  const platformFonts = PLATFORM_FONTS[resolved] ?? PLATFORM_FONTS.linux

  const parts: string[] = []

  if (custom && custom.trim().length > 0) {
    parts.push(custom)
  }

  parts.push(...platformFonts)
  parts.push('monospace')

  return parts
    .map(p => (p.includes(' ') || p.includes(',') ? `"${p}"` : p))
    .join(', ')
}
