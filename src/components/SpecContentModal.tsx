import React from 'react'
import { theme } from '../common/theme'
import { remToPx } from '../common/remScale'
import { ResizableModal } from './shared/ResizableModal'

interface SpecContentModalProps {
  specName: string
  content: string
  onClose: () => void
}

export const SpecContentModal: React.FC<SpecContentModalProps> = ({
  specName,
  content,
  onClose
}) => {
  return (
    <ResizableModal
      isOpen={true}
      onClose={onClose}
      title={specName}
      storageKey="spec-content"
      defaultWidth={remToPx(64)}
      defaultHeight={remToPx(43)}
      minWidth={remToPx(36)}
      minHeight={remToPx(29)}
    >
      <div className="p-6">
        <pre
          className="whitespace-pre-wrap font-mono"
          style={{
            fontSize: theme.fontSize.code,
            color: 'var(--color-text-primary)',
            lineHeight: '1.6'
          }}
        >
          {content || 'No content available'}
        </pre>
      </div>
    </ResizableModal>
  )
}
