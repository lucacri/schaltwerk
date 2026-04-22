import { useCallback, useEffect, useRef, useState } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { matchesProjectScope, type SessionsRefreshedEventPayload } from '../common/events'

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
  const isStatic = sessionState === 'running'
  const refreshVersionRef = useRef(0)
  const contentRef = useRef(content)

  useEffect(() => {
    contentRef.current = content
  }, [content])

  useEffect(() => {
    let mounted = true
    const requestVersion = refreshVersionRef.current

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
        if (!mounted || refreshVersionRef.current !== requestVersion) return
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

  useEffect(() => {
    if (isStatic) {
      return
    }

    let cleaned = false
    let unlisten: (() => void) | null = null

    const handleSessionsRefreshed = (payload: SessionsRefreshedEventPayload) => {
      if (!matchesProjectScope(payload.projectPath, projectPath)) {
        return
      }

      const refreshedSession = payload.sessions.find(({ info }) => {
        return info.session_id === sessionName || info.branch === sessionName
      })

      if (!refreshedSession) {
        return
      }

      const nextContent = refreshedSession.info.spec_content ?? refreshedSession.info.current_task ?? ''
      const cachedEntry = specCache.get(cacheKey)

      if (cachedEntry?.content === nextContent && contentRef.current === nextContent) {
        return
      }

      refreshVersionRef.current += 1
      specCache.set(cacheKey, {
        content: nextContent,
        isStatic,
      })

      setContent(previous => previous === nextContent ? previous : nextContent)
      setError(null)
      setLoading(false)
    }

    void listenEvent(SchaltEvent.SessionsRefreshed, handleSessionsRefreshed)
      .then((dispose) => {
        if (cleaned) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch((listenError) => {
        logger.warn('[useSpecContentCache] Failed to subscribe to SessionsRefreshed', listenError)
      })

    return () => {
      cleaned = true
      unlisten?.()
    }
  }, [cacheKey, isStatic, projectPath, sessionName])

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
