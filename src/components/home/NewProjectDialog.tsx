import { useEffect, useState } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { VscFolderOpened, VscClose, VscNewFolder } from 'react-icons/vsc'
import { homeDir } from '@tauri-apps/api/path'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n'
import { ModalPortal } from '../shared/ModalPortal'
import { Button, FormGroup, TextInput } from '../ui'

interface NewProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onProjectCreated: (_path: string) => void
}

export function NewProjectDialog({ isOpen, onClose, onProjectCreated }: NewProjectDialogProps) {
  const { t } = useTranslation()
  const [projectName, setProjectName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || parentPath) {
      return
    }

    let isCancelled = false

    const hydrateParentPath = async () => {
      try {
        const persisted = await invoke<string | null>(TauriCommands.GetLastProjectParentDirectory)
        if (!isCancelled && persisted && persisted.trim().length > 0) {
          setParentPath(persisted)
          return
        }
      } catch (err) {
        logger.error('Failed to load last project parent directory:', err)
      }

      try {
        const home = await homeDir()
        if (!isCancelled) {
          setParentPath(home)
        }
      } catch (err) {
        if (!isCancelled) {
          logger.error('Failed to get home directory:', err)
        }
      }
    }

    void hydrateParentPath()

    return () => {
      isCancelled = true
    }
  }, [isOpen, parentPath])

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.newProject.selectParentDir
      })

      if (selected) {
        const selectedPath = selected as string
        setParentPath(selectedPath)
        try {
          await invoke(TauriCommands.SetLastProjectParentDirectory, { path: selectedPath })
        } catch (persistError) {
          logger.error('Failed to persist selected parent directory:', persistError)
        }
      }
    } catch (err) {
      logger.error('Failed to select directory:', err)
      setError(`Failed to select directory: ${err}`)
    }
  }

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name')
      return
    }

    if (!parentPath) {
      setError('Please select a parent directory')
      return
    }

    const invalidChars = /[<>:"|?*/\\]/
    if (invalidChars.test(projectName)) {
      setError('Project name contains invalid characters')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      try {
        await invoke(TauriCommands.SetLastProjectParentDirectory, { path: parentPath })
      } catch (persistError) {
        logger.error('Failed to persist parent directory before creating project:', persistError)
      }

      const projectPath = await invoke<string>(TauriCommands.CreateNewProject, {
        name: projectName.trim(),
        parentPath
      })

      onProjectCreated(projectPath)
      onClose()
    } catch (err) {
      logger.error('Failed to create project:', err)
      setError(`Failed to create project: ${err}`)
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      void handleCreate()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-bg-primary/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div 
          className="bg-bg-secondary border border-border-subtle rounded-lg p-6 max-w-md w-full mx-4"
          onKeyDown={handleKeyDown}
        >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <VscNewFolder className="text-accent-cyan text-2xl" />
            <h2 className="text-xl font-semibold text-text-secondary">{t.newProject.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors"
            disabled={isCreating}
          >
            <VscClose className="text-xl" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-accent-red-bg)] border border-[var(--color-accent-red-border)] rounded text-accent-red text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <FormGroup label={t.newProject.projectName} htmlFor="new-project-name">
            <TextInput
              id="new-project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t.newProject.projectNamePlaceholder}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={isCreating}
            />
          </FormGroup>

          <FormGroup label={t.newProject.parentDirectory} htmlFor="new-project-parent-directory">
            <div className="flex gap-2">
              <TextInput
                id="new-project-parent-directory"
                type="text"
                value={parentPath}
                readOnly
                placeholder={t.newProject.parentDirPlaceholder}
                disabled={isCreating}
                className="flex-1"
              />
              <Button
                onClick={() => { void handleSelectDirectory() }}
                disabled={isCreating}
                leftIcon={<VscFolderOpened className="text-lg" />}
              >
                {t.newProject.browse}
              </Button>
            </div>
          </FormGroup>

          <div className="bg-bg-primary/30 border border-border-subtle rounded-lg p-3 text-sm text-text-tertiary">
            <p>{t.newProject.createInfo}</p>
            {projectName && parentPath && (
              <p className="mt-2 text-accent-cyan font-mono text-xs">
                {parentPath}/{projectName}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button
            onClick={onClose}
            className="flex-1"
            disabled={isCreating}
          >
            {t.newProject.cancel}
          </Button>
          <Button
            onClick={() => { void handleCreate() }}
            disabled={isCreating || !projectName.trim() || !parentPath}
            className="flex-1"
            variant="primary"
          >
            {isCreating ? (
              <AnimatedText text="loading" size="xs" />
            ) : (
              t.newProject.createProject
            )}
          </Button>
        </div>
        </div>
      </div>
    </ModalPortal>
  )
}
