import { forwardRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from '../../common/i18n'

type Props = {
  searchTerm: string
  onSearchTermChange: (value: string) => void
  onFindNext: () => void
  onFindPrevious: () => void
  onClose: () => void
}

export const TerminalSearchPanel = forwardRef<HTMLDivElement, Props>(
  ({ searchTerm, onSearchTermChange, onFindNext, onFindPrevious, onClose }, ref) => {
    const { t } = useTranslation()
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key === 'Enter') {
        if (event.shiftKey) {
          onFindPrevious()
        } else {
          onFindNext()
        }
      }
    }

    return (
      <div
        ref={ref}
        data-terminal-search="true"
        className="absolute top-2 right-2 flex items-center bg-bg-elevated border border-border-default rounded px-2 py-1 z-10 shadow-lg"
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.terminalSearch.placeholder}
          className="bg-transparent text-sm text-text-secondary outline-none w-40 placeholder:text-text-muted"
          autoFocus
        />
        <button
          onClick={onFindPrevious}
          className="text-text-tertiary hover:text-text-primary ml-1"
          title={t.terminalSearch.previousMatch}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M7 12L3 8L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onFindNext}
          className="text-text-tertiary hover:text-text-primary ml-1"
          title={t.terminalSearch.nextMatch}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M9 4L13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary ml-2"
          title={t.terminalSearch.closeSearch}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    )
  }
)

TerminalSearchPanel.displayName = 'TerminalSearchPanel'
