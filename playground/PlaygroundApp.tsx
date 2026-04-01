import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { Sidebar } from '../src/components/sidebar/Sidebar'
import { Controls } from './controls'
import { projectPathAtom } from '../src/store/atoms/project'
import {
  initializeSessionsSettingsActionAtom,
  refreshSessionsActionAtom,
} from '../src/store/atoms/sessions'

export function PlaygroundApp() {
  const [sidebarWidth, setSidebarWidth] = useState(288)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const setProjectPath = useSetAtom(projectPathAtom)
  const initializeSessionsSettings = useSetAtom(initializeSessionsSettingsActionAtom)
  const refreshSessions = useSetAtom(refreshSessionsActionAtom)

  useEffect(() => {
    setProjectPath('/mock/playground-project')
    void initializeSessionsSettings()
    void refreshSessions()
  }, [setProjectPath, initializeSessionsSettings, refreshSessions])

  const handleToggleSidebar = useCallback(() => {
    setIsCollapsed(prev => !prev)
  }, [])

  const handleExpandRequest = useCallback(() => {
    setIsCollapsed(false)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div
        className="h-full flex-shrink-0 border-r border-subtle overflow-hidden"
        style={{ width: isCollapsed ? 48 : sidebarWidth }}
      >
        <Sidebar
          isCollapsed={isCollapsed}
          onToggleSidebar={handleToggleSidebar}
          onExpandRequest={handleExpandRequest}
        />
      </div>
      <div className="flex-1 overflow-auto bg-primary p-6">
        <Controls
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
          isCollapsed={isCollapsed}
          onCollapsedChange={setIsCollapsed}
        />
      </div>
    </div>
  )
}
