import { useCallback, useEffect, useState } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'

interface SpecCacheEntry {
  content: string
  isStatic: boolean
}

const specCache = new Map<string, SpecCacheEntry>()

function buildSpecCacheKey(projectPath: string | null | undefined, sessionName: string) {
  return `${projectPath ?? '__default__'}::${sessionName}`
}

function deleteSpecCacheEntries(sessionName: string, projectPath?: string | null) {
  specCache.delete(sessionName)
  specCache.delete(buildSpecCacheKey(projectPath, sessionName))
}

export function useSpecContentCache(
  sessionName: string,
  sessionState?: 'spec' | 'processing' | 'running',
) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const projectPath = useAtomValue(projectPathAtom)
  const cacheKey = buildSpecCacheKey(projectPath, sessionName)

  useEffect(() => {
    let mounted = true
    const isStatic = sessionState === 'running'

    const cached = specCache.get(cacheKey)
    if (cached) {
      setContent(cached.content)
      if (cached.isStatic) {
        setLoading(false)
        logger.debug(`[useSpecContentCache] Cache hit for static session: ${sessionName}`)
        return
      } else {
        setLoading(true)
      }
    } else {
      setContent('')
      setLoading(true)
    }

    setError(null)

    const projectScope = projectPath ? { projectPath } : {}

    invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName, ...projectScope })
      .then(([draftContent, initialPrompt]) => {
        if (!mounted) return
        const text: string = draftContent ?? initialPrompt ?? ''

        specCache.set(cacheKey, {
          content: text,
          isStatic,
        })

        setContent(text)
        setLoading(false)

        if (isStatic) {
          logger.debug(`[useSpecContentCache] Cached static session: ${sessionName}`)
        }
      })
      .catch((e) => {
        if (!mounted) return
        logger.error('[useSpecContentCache] Failed to get spec content:', e)
        setError(String(e))
        setLoading(false)
      })

    return () => { mounted = false }
  }, [cacheKey, projectPath, sessionName, sessionState])

  const updateContent = useCallback((value: string) => {
    setContent(value)
    specCache.set(cacheKey, {
      content: value,
      isStatic: false,
    })
  }, [cacheKey])

  const invalidateCache = useCallback(() => {
    deleteSpecCacheEntries(sessionName, projectPath)
  }, [projectPath, sessionName])

  return {
    content,
    loading,
    error,
    updateContent,
    invalidateCache,
  }
}

export function invalidateSpecCache(sessionName: string, projectPath?: string | null) {
  deleteSpecCacheEntries(sessionName, projectPath)
}

export function clearAllSpecCache() {
  specCache.clear()
}
