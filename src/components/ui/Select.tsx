import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { theme } from '../../common/theme'
import { calculateDropdownGeometry, type DropdownGeometry } from '../inputs/dropdownGeometry'
import { controlHeightStyles, controlTextStyle } from './styles'

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  disabled?: boolean
  placeholder?: string
  className?: string
}

const isPrintableKey = (key: string) => key.length === 1 && key.trim().length > 0

function findFirstEnabled(options: SelectOption[]) {
  return options.findIndex(option => !option.disabled)
}

function findNextEnabled(options: SelectOption[], startIndex: number, direction: 1 | -1) {
  if (options.length === 0) return -1

  let index = startIndex
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index]?.disabled) {
      return index
    }
  }

  return -1
}

function findMatchByQuery(options: SelectOption[], query: string, startIndex: number) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return -1

  for (let step = 1; step <= options.length; step += 1) {
    const index = (startIndex + step) % options.length
    const option = options[index]
    if (!option.disabled && option.label.toLowerCase().startsWith(normalized)) {
      return index
    }
  }

  return -1
}

export function Select({ value, onChange, options, disabled = false, placeholder = 'Select', className }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [, setTypeahead] = useState('')
  const [menuGeometry, setMenuGeometry] = useState<DropdownGeometry | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selectedIndex = useMemo(() => options.findIndex(option => option.value === value), [options, value])
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null

  useEffect(() => {
    if (open) {
      setFocusedIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : findFirstEnabled(options))
      setTypeahead('')
    } else {
      setFocusedIndex(-1)
      setTypeahead('')
    }
  }, [open, options, selectedIndex])

  useLayoutEffect(() => {
    if (!open) {
      setMenuGeometry(null)
      return
    }

    const updateGeometry = () => {
      const container = containerRef.current
      if (!container) return

      setMenuGeometry(calculateDropdownGeometry({
        anchorRect: container.getBoundingClientRect(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        alignment: 'stretch',
        minWidth: 180,
      }))
    }

    updateGeometry()
    window.addEventListener('scroll', updateGeometry, true)
    window.addEventListener('resize', updateGeometry)

    return () => {
      window.removeEventListener('scroll', updateGeometry, true)
      window.removeEventListener('resize', updateGeometry)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault()
          setTypeahead('')
          setFocusedIndex(current => findNextEnabled(options, current < 0 ? selectedIndex : current, 1))
          break
        }
        case 'ArrowUp': {
          event.preventDefault()
          setTypeahead('')
          setFocusedIndex(current => findNextEnabled(options, current < 0 ? selectedIndex + 1 : current, -1))
          break
        }
        case 'Enter':
        case ' ': {
          event.preventDefault()
          const option = options[focusedIndex]
          if (option && !option.disabled) {
            onChange(option.value)
            setOpen(false)
          }
          break
        }
        case 'Escape': {
          event.preventDefault()
          setOpen(false)
          break
        }
        case 'Backspace': {
          event.preventDefault()
          setTypeahead(current => current.slice(0, -1))
          break
        }
        default: {
          if (!isPrintableKey(event.key)) return
          event.preventDefault()
          setTypeahead(current => {
            const nextQuery = `${current}${event.key.toLowerCase()}`
            const fallbackQuery = event.key.toLowerCase()
            const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex
            const match = findMatchByQuery(options, nextQuery, currentIndex)
            const resolvedQuery = match >= 0 ? nextQuery : fallbackQuery
            const resolvedMatch = match >= 0 ? match : findMatchByQuery(options, resolvedQuery, currentIndex)

            if (resolvedMatch >= 0) {
              setFocusedIndex(resolvedMatch)
            }

            return resolvedQuery
          })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedIndex, onChange, open, options, selectedIndex])

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ': {
        event.preventDefault()
        setOpen(true)
        break
      }
    }
  }

  return (
    <div ref={containerRef} className={clsx('relative w-full', className)}>
      <button
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={selectedOption?.label ?? placeholder}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen(current => !current)
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className={clsx(
          'flex w-full items-center justify-between gap-2 rounded-[var(--control-border-radius)] border border-[var(--control-border)] bg-[var(--control-bg)] px-[var(--control-padding-x)] text-left text-text-primary transition-[background-color,border-color,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:border-[var(--control-border-focus)]',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--control-bg-hover)]',
        )}
        style={{ ...controlHeightStyles.md, ...controlTextStyle }}
      >
        <span className={clsx('truncate', selectedOption ? 'text-text-primary' : 'text-text-muted')}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={clsx('h-4 w-4 shrink-0 text-text-muted transition-transform duration-150', open ? 'rotate-180' : undefined)}>
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      </button>
      {open && menuGeometry
        ? createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: theme.layers.dropdownOverlay }} onClick={() => setOpen(false)} />
              <div
                id={listboxId}
                role="listbox"
                className="overflow-auto rounded-[var(--control-border-radius)] border border-border-default bg-bg-elevated py-1"
                style={{
                  position: 'fixed',
                  ...(menuGeometry.placement === 'above' ? { bottom: menuGeometry.bottom } : { top: menuGeometry.top }),
                  left: menuGeometry.left,
                  width: menuGeometry.width,
                  maxHeight: menuGeometry.maxHeight,
                  zIndex: theme.layers.dropdownMenu,
                  boxShadow: '0 12px 30px rgba(var(--color-bg-primary-rgb), 0.48)',
                }}
              >
                {options.map((option, index) => {
                  const isFocused = index === focusedIndex
                  const isSelected = option.value === value
                  const isDisabled = Boolean(option.disabled)

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={isDisabled}
                      onClick={() => {
                        if (!isDisabled) {
                          onChange(option.value)
                          setOpen(false)
                        }
                      }}
                      className={clsx(
                        'flex w-full items-center px-3 py-1.5 text-left transition-colors duration-150',
                        isDisabled ? 'cursor-not-allowed text-text-muted opacity-50' : 'cursor-pointer text-text-primary',
                        isFocused ? 'bg-[var(--color-accent-blue-bg)]' : isSelected ? 'bg-bg-hover' : 'bg-transparent hover:bg-[var(--control-bg-hover)]',
                      )}
                      style={controlTextStyle}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}
