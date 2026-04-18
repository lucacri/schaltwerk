import { typography } from '../../common/typography'
import { theme } from '../../common/theme'
import { SectionHeader } from '../../components/ui'

type TypographyRow = {
  label: string
  sample: string
  entry: (typeof typography)[keyof typeof typography]
  weight?: number
  transform?: 'uppercase'
  letterSpacing?: string
}

const sansRows: TypographyRow[] = [
  { label: 'display', sample: 'The quick brown fox', entry: typography.display, weight: 600 },
  { label: 'headingXLarge', sample: 'The quick brown fox jumps over the lazy dog', entry: typography.headingXLarge, weight: 600 },
  { label: 'headingLarge', sample: 'The quick brown fox jumps over the lazy dog', entry: typography.headingLarge, weight: 600 },
  { label: 'heading', sample: 'The quick brown fox jumps over the lazy dog', entry: typography.heading, weight: 600 },
  { label: 'bodyLarge', sample: 'The quick brown fox jumps over the lazy dog', entry: typography.bodyLarge },
  { label: 'body', sample: 'The quick brown fox jumps over the lazy dog', entry: typography.body },
  { label: 'input', sample: 'The quick brown fox jumps over the lazy dog', entry: typography.input },
  { label: 'button', sample: 'Click me', entry: typography.button, weight: 500 },
  { label: 'label', sample: 'Form field label', entry: typography.label, weight: 500 },
  { label: 'caption', sample: 'Helper or caption text', entry: typography.caption },
]

const monoRows: TypographyRow[] = [
  { label: 'code', sample: 'const session = await createWorktree(name);', entry: typography.code },
  { label: 'terminal', sample: '$ bun run tauri:dev', entry: typography.terminal },
]

const hierarchyRows: { label: string; color: string }[] = [
  { label: 'Primary text — used for main content and headings', color: 'var(--color-text-primary)' },
  { label: 'Secondary text — used for labels and supporting content', color: 'var(--color-text-secondary)' },
  { label: 'Tertiary text — used for help text and descriptions', color: 'var(--color-text-tertiary)' },
  { label: 'Muted text — used for disabled and placeholder content', color: 'var(--color-text-muted)' },
]

function Row({ row }: { row: TypographyRow }) {
  return (
    <div className="flex items-baseline gap-4">
      <span
        className="w-32 shrink-0 font-mono text-text-muted"
        style={{ fontSize: theme.fontSize.caption }}
      >
        {row.label}
      </span>
      <span
        className="truncate text-text-primary"
        style={{
          fontSize: row.entry.fontSize,
          lineHeight: row.entry.lineHeight,
          fontFamily: row.entry.fontFamily,
          fontWeight: row.weight ?? 400,
          textTransform: row.transform,
          letterSpacing: row.letterSpacing,
        }}
      >
        {row.sample}
      </span>
    </div>
  )
}

export function TypographySection() {
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-secondary p-5 space-y-6">
      <SectionHeader title="Typography" description="Type scale anchored on `--ui-font-size` (14px default) × per-token multipliers." />

      <div className="space-y-4">
        <h3
          className="uppercase text-text-muted font-semibold"
          style={{ fontSize: theme.fontSize.caption, letterSpacing: '0.1em' }}
        >
          Sans
        </h3>
        <div className="space-y-3">
          {sansRows.map((row) => (
            <Row key={row.label} row={row} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3
          className="uppercase text-text-muted font-semibold"
          style={{ fontSize: theme.fontSize.caption, letterSpacing: '0.1em' }}
        >
          Mono
        </h3>
        <div className="space-y-3">
          {monoRows.map((row) => (
            <Row key={row.label} row={row} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3
          className="uppercase text-text-muted font-semibold"
          style={{ fontSize: theme.fontSize.caption, letterSpacing: '0.1em' }}
        >
          Text Hierarchy
        </h3>
        <div className="space-y-1">
          {hierarchyRows.map((row) => (
            <p
              key={row.label}
              style={{ ...typography.body, color: row.color }}
            >
              {row.label}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
