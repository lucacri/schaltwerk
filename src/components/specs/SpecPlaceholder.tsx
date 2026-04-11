import { useSelection } from '../../hooks/useSelection'
import { SpecEditor } from './SpecEditor'
import { useTranslation } from '../../common/i18n'

export function SpecPlaceholder() {
  const { t } = useTranslation()
  const { selection } = useSelection()

  const sessionName = selection.kind === 'session' ? selection.payload : undefined

  if (!sessionName) {
    return <div className="h-full flex items-center justify-center text-text-tertiary">{t.specWorkspacePanel.noSpecSelected}</div>
  }

  return <SpecEditor sessionName={sessionName} />
}
