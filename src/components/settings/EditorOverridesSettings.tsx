import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'

interface OpenApp {
  id: string
  name: string
  kind: 'editor' | 'terminal' | 'system'
}

interface EditorOverridesSettingsProps {
  onNotification: (message: string, type: 'success' | 'error') => void
}

export function EditorOverridesSettings({ onNotification }: EditorOverridesSettingsProps) {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [editors, setEditors] = useState<OpenApp[]>([])
  const [newExtension, setNewExtension] = useState('')
  const [newEditor, setNewEditor] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [loadedOverrides, apps] = await Promise.all([
          invoke<Record<string, string>>(TauriCommands.GetEditorOverrides),
          invoke<OpenApp[]>(TauriCommands.ListAvailableOpenApps),
        ])
        setOverrides(loadedOverrides)
        const editorApps = apps.filter(app => app.kind === 'editor')
        setEditors(editorApps)
        if (editorApps.length > 0 && !newEditor) {
          setNewEditor(editorApps[0].id)
        }
      } catch (error) {
        logger.error('Failed to load editor overrides settings', error)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const save = useCallback(async (updated: Record<string, string>) => {
    try {
      await invoke(TauriCommands.SetEditorOverrides, { overrides: updated })
      setOverrides(updated)
      onNotification('Editor overrides saved', 'success')
    } catch (error) {
      logger.error('Failed to save editor overrides', error)
      onNotification('Failed to save editor overrides', 'error')
    }
  }, [onNotification])

  const handleAdd = useCallback(() => {
    const ext = newExtension.startsWith('.') ? newExtension : `.${newExtension}`
    if (!ext || ext === '.' || !newEditor) return
    if (overrides[ext]) {
      onNotification(`Override for ${ext} already exists`, 'error')
      return
    }
    const updated = { ...overrides, [ext]: newEditor }
    void save(updated)
    setNewExtension('')
  }, [newExtension, newEditor, overrides, save, onNotification])

  const handleRemove = useCallback((ext: string) => {
    const updated = { ...overrides }
    delete updated[ext]
    void save(updated)
  }, [overrides, save])

  const handleEditorChange = useCallback((ext: string, editorId: string) => {
    const updated = { ...overrides, [ext]: editorId }
    void save(updated)
  }, [overrides, save])

  if (loading) return null

  const sortedEntries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-medium text-text-primary mb-2">File Editor Overrides</h3>
        <div className="text-body text-text-tertiary mb-4">
          Configure which editor opens for specific file extensions. Files without an override use your system default application.
        </div>
      </div>

      {sortedEntries.length > 0 && (
        <div className="border border-border-subtle rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-elevated">
                <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">Extension</th>
                <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">Editor</th>
                <th className="w-10 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(([ext, editorId]) => (
                <tr key={ext} className="border-t border-border-subtle">
                  <td className="px-4 py-2 text-body text-text-primary font-mono">{ext}</td>
                  <td className="px-4 py-2">
                    <select
                      value={editorId}
                      onChange={(e) => handleEditorChange(ext, e.target.value)}
                      className="bg-bg-elevated text-text-primary text-body border border-border-subtle rounded px-2 py-1"
                    >
                      {editors.map(editor => (
                        <option key={editor.id} value={editor.id}>{editor.name}</option>
                      ))}
                      {!editors.some(e => e.id === editorId) && (
                        <option value={editorId}>{editorId}</option>
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleRemove(ext)}
                      className="text-text-tertiary hover:text-status-error transition-colors"
                      title="Remove override"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editors.length > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newExtension}
            onChange={(e) => setNewExtension(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder=".rs"
            className="bg-bg-elevated text-text-primary text-body border border-border-subtle rounded px-3 py-1.5 w-24 font-mono"
          />
          <select
            value={newEditor}
            onChange={(e) => setNewEditor(e.target.value)}
            className="bg-bg-elevated text-text-primary text-body border border-border-subtle rounded px-2 py-1.5 flex-1"
          >
            {editors.map(editor => (
              <option key={editor.id} value={editor.id}>{editor.name}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!newExtension || !newEditor}
            className="bg-accent-blue text-white text-body px-3 py-1.5 rounded disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            Add
          </button>
        </div>
      )}

      {editors.length === 0 && (
        <div className="text-body text-text-tertiary">
          No code editors detected on your system. Install VS Code, Cursor, Zed, or IntelliJ to configure editor overrides.
        </div>
      )}
    </div>
  )
}
