import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import {
  enabledAgentsAtom,
  enabledAgentsErrorAtom,
  enabledAgentsLoadingAtom,
  loadEnabledAgentsAtom,
  reloadEnabledAgentsAtom,
  saveEnabledAgentsAtom,
  setEnabledAgentsAtom,
} from '../store/atoms/enabledAgents'
import {
  filterEnabledAgents,
  mergeEnabledAgents,
  type AgentType,
  type EnabledAgents,
} from '../types/session'

export function useEnabledAgents() {
  const enabledAgents = useAtomValue(enabledAgentsAtom)
  const loading = useAtomValue(enabledAgentsLoadingAtom)
  const error = useAtomValue(enabledAgentsErrorAtom)
  const load = useSetAtom(loadEnabledAgentsAtom)
  const reload = useSetAtom(reloadEnabledAgentsAtom)
  const save = useSetAtom(saveEnabledAgentsAtom)
  const setEnabledAgents = useSetAtom(setEnabledAgentsAtom)

  useEffect(() => {
    void load()
  }, [load])

  const filterAgents = useCallback((agents: readonly AgentType[]) => {
    return filterEnabledAgents(agents, enabledAgents)
  }, [enabledAgents])

  const isAgentEnabled = useCallback((agent: AgentType) => {
    return enabledAgents[agent]
  }, [enabledAgents])

  const saveAgents = useCallback((next: EnabledAgents) => {
    return save(mergeEnabledAgents(next))
  }, [save])

  const replaceAgents = useCallback((next: EnabledAgents) => {
    setEnabledAgents(mergeEnabledAgents(next))
  }, [setEnabledAgents])

  const reloadEnabledAgents = useCallback(() => {
    return reload()
  }, [reload])

  return {
    enabledAgents,
    loading,
    error,
    filterAgents,
    isAgentEnabled,
    saveEnabledAgents: saveAgents,
    setEnabledAgents: replaceAgents,
    reloadEnabledAgents,
  }
}
