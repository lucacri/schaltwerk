import { useEffect, useSyncExternalStore } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Select } from '../components/ui'
import { currentThemeIdAtom, setThemeActionAtom } from '../store/atoms/theme'
import { STYLE_GUIDE_THEMES, applyStyleGuideTheme, persistStyleGuideTheme } from './mocks'
import { PrimitivesSection } from './sections/PrimitivesSection'
import { SessionPrimitivesSection } from './sections/SessionPrimitivesSection'
import { CommonSection } from './sections/CommonSection'
import { SettingsSection } from './sections/SettingsSection'
import { DialogsSection } from './sections/DialogsSection'
import { ColorReferenceSection } from './sections/ColorReferenceSection'
import { TypographySection } from './sections/TypographySection'

function subscribeToSystemTheme(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleChange = () => callback()

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }

  mediaQuery.addListener(handleChange)
  return () => mediaQuery.removeListener(handleChange)
}

function getSystemThemeSnapshot() {
  if (typeof window === 'undefined') {
    return true
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function StyleGuide() {
  const currentTheme = useAtomValue(currentThemeIdAtom)
  const setTheme = useSetAtom(setThemeActionAtom)
  const systemPrefersDark = useSyncExternalStore(subscribeToSystemTheme, getSystemThemeSnapshot, () => true)
  const resolvedTheme = currentTheme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : currentTheme

  useEffect(() => {
    applyStyleGuideTheme(resolvedTheme)
    persistStyleGuideTheme(currentTheme)
  }, [currentTheme, resolvedTheme])

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-[rgba(var(--color-bg-primary-rgb),0.92)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-caption uppercase tracking-[0.24em] text-text-muted">Lucode</p>
            <div className="space-y-1">
              <h1 className="text-heading-large font-semibold text-text-primary">Standalone Style Guide</h1>
              <p className="max-w-3xl text-body text-text-secondary">
                Browser-only gallery for fast theme and component iteration under `bun run style-guide`. The theme switcher and settings panels are live; the primitive cards are visual references.
              </p>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-2">
            <label htmlFor="style-guide-theme" className="block text-label font-medium text-text-secondary">
              Theme
            </label>
            <Select
              id="style-guide-theme"
              aria-label="Theme"
              value={resolvedTheme}
              onChange={(value) => {
                void setTheme(value as typeof resolvedTheme)
              }}
              options={STYLE_GUIDE_THEMES}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
        <PrimitivesSection />
        <SessionPrimitivesSection />
        <CommonSection />
        <SettingsSection />
        <DialogsSection />
        <ColorReferenceSection resolvedTheme={resolvedTheme} />
        <TypographySection />
      </main>
    </div>
  )
}
