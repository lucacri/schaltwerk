import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../common/i18n'
import { Button, Checkbox, TextInput } from '../ui'

type FontEntry = { family: string; monospace: boolean }

interface Props {
  load: () => Promise<FontEntry[]>
  onSelect: (family: string) => void
  onClose: () => void
}

export function FontPicker({ load, onSelect, onClose }: Props) {
  const { t } = useTranslation()
  const [fonts, setFonts] = useState<FontEntry[]>([])
  const [query, setQuery] = useState('')
  const [monoOnly, setMonoOnly] = useState(true)

  useEffect(() => {
    let cancelled = false
    void load().then(list => { if (!cancelled) setFonts(list) })
    return () => { cancelled = true }
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return fonts.filter(f => (!monoOnly || f.monospace) && (q === '' || f.family.toLowerCase().includes(q)))
  }, [fonts, query, monoOnly])

  return (
    <div className="mt-2 rounded border border-border-subtle bg-bg-secondary/70 p-3">
      <div className="flex items-center gap-2 mb-2">
        <TextInput
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.fontPicker.searchPlaceholder}
          type="search"
          className="flex-1"
        />
        <Checkbox checked={monoOnly} onChange={setMonoOnly} label={t.fontPicker.monoOnly} />
        <Button onClick={onClose} size="sm">{t.fontPicker.close}</Button>
      </div>
      <div className="max-h-56 overflow-auto rounded border border-border-subtle">
        {filtered.length === 0 ? (
          <div className="p-3 text-caption text-text-muted">{t.fontPicker.noFonts}</div>
        ) : (
          <ul>
            {filtered.map(f => (
              <li key={f.family}>
                <button
                  onClick={() => onSelect(f.family)}
                  className="w-full px-3 py-2 text-left transition-colors hover:bg-[rgba(var(--color-bg-hover-rgb),0.45)]">
                  <span className="text-text-primary">{f.family}</span>
                  {f.monospace ? <span className="ml-2 rounded bg-bg-elevated px-2 py-0.5 text-caption text-text-secondary">{t.fontPicker.mono}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
