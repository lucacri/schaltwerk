import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { theme } from '../../common/theme'

export interface DropdownMenuActionItem {
  kind: 'action'
  key: string
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

export interface DropdownMenuSeparatorItem {
  kind: 'separator'
  key: string
}

export type DropdownMenuItem = DropdownMenuActionItem | DropdownMenuSeparatorItem

export interface DropdownMenuProps {
  items: DropdownMenuItem[]
  onDismiss: () => void
  labelledBy?: string
  ariaLabel?: string
  className?: string
  style?: CSSProperties
  initialFocusIndex?: number
  width?: number
}

function isActionable(item: DropdownMenuItem): item is DropdownMenuActionItem {
  return item.kind === 'action' && !item.disabled
}

function nextFocusable(items: DropdownMenuItem[], from: number, direction: 1 | -1): number {
  const count = items.length
  if (count === 0) return -1
  let index = from
  for (let step = 0; step < count; step += 1) {
    index = (index + direction + count) % count
    if (isActionable(items[index])) return index
  }
  return -1
}

export function DropdownMenu({
  items,
  onDismiss,
  labelledBy,
  ariaLabel,
  className,
  style,
  initialFocusIndex,
  width = 200,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusIndex = useCallback((index: number) => {
    const target = itemRefs.current[index]
    if (target) target.focus()
  }, [])

  useEffect(() => {
    if (items.length === 0) return
    const startAt =
      typeof initialFocusIndex === 'number' && isActionable(items[initialFocusIndex])
        ? initialFocusIndex
        : items.findIndex(isActionable)
    if (startAt >= 0) focusIndex(startAt)
  }, [focusIndex, initialFocusIndex, items])

  useEffect(() => {
    const handleDocMouseDown = (event: MouseEvent) => {
      if (!menuRef.current) return
      if (menuRef.current.contains(event.target as Node)) return
      onDismiss()
    }
    document.addEventListener('mousedown', handleDocMouseDown)
    return () => document.removeEventListener('mousedown', handleDocMouseDown)
  }, [onDismiss])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.findIndex(el => el === document.activeElement)

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        onDismiss()
        return
      case 'ArrowDown':
        event.preventDefault()
        focusIndex(nextFocusable(items, currentIndex, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        focusIndex(nextFocusable(items, currentIndex, -1))
        return
      case 'Home':
        event.preventDefault()
        focusIndex(items.findIndex(isActionable))
        return
      case 'End': {
        event.preventDefault()
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (isActionable(items[i])) {
            focusIndex(i)
            return
          }
        }
        return
      }
      default:
        return
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={clsx('focus:outline-none', className)}
      style={{
        width,
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(var(--color-gray-950-rgb, 0 0 0), 0.375)',
        padding: '4px 0',
        ...style,
      }}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return (
            <div
              key={item.key}
              role="separator"
              style={{
                height: 1,
                backgroundColor: 'var(--color-border-subtle)',
                margin: '4px 0',
              }}
            />
          )
        }

        const ref = (el: HTMLButtonElement | null) => {
          itemRefs.current[index] = el
        }

        return (
          <button
            key={item.key}
            ref={ref}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onSelect()
                onDismiss()
              }
            }}
            className={clsx(
              'flex w-full items-center gap-2 text-left transition-colors focus:outline-none',
              item.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              'focus-visible:bg-[var(--color-bg-hover)] hover:bg-[var(--color-bg-hover)]',
            )}
            style={{
              height: 32,
              padding: '0 12px',
              fontSize: theme.fontSize.body,
              color: item.destructive ? 'var(--color-accent-red)' : 'var(--color-text-primary)',
            }}
          >
            {item.icon ? (
              <span
                aria-hidden="true"
                className="inline-flex shrink-0 items-center justify-center"
                style={{
                  width: 14,
                  height: 14,
                  color: item.destructive
                    ? 'var(--color-accent-red)'
                    : 'var(--color-text-tertiary)',
                }}
              >
                {item.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
