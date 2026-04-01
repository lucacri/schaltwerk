import React from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { Provider as JotaiProvider } from 'jotai'
import { ToastProvider } from '../src/common/toast/ToastProvider'
import { KeyboardShortcutsProvider } from '../src/contexts/KeyboardShortcutsContext'
import { FocusProvider } from '../src/contexts/FocusContext'
import { ReviewProvider } from '../src/contexts/ReviewContext'
import { RunProvider } from '../src/contexts/RunContext'
import { ModalProvider } from '../src/contexts/ModalContext'
import { GithubIntegrationProvider } from '../src/contexts/GithubIntegrationContext'
import { GitlabIntegrationProvider } from '../src/contexts/GitlabIntegrationContext'
import { ForgeIntegrationProvider } from '../src/contexts/ForgeIntegrationContext'
import ErrorBoundary from '../src/components/ErrorBoundary'
import { PlaygroundApp } from './PlaygroundApp'

const root = document.getElementById('root')!
const reactRoot = ReactDOM.createRoot(root)

reactRoot.render(
  <React.StrictMode>
    <ErrorBoundary name="Playground">
      <ToastProvider>
        <KeyboardShortcutsProvider>
          <JotaiProvider>
            <ForgeIntegrationProvider>
              <GithubIntegrationProvider>
                <GitlabIntegrationProvider>
                  <ModalProvider>
                    <FocusProvider>
                      <ReviewProvider>
                        <RunProvider>
                          <PlaygroundApp />
                        </RunProvider>
                      </ReviewProvider>
                    </FocusProvider>
                  </ModalProvider>
                </GitlabIntegrationProvider>
              </GithubIntegrationProvider>
            </ForgeIntegrationProvider>
          </JotaiProvider>
        </KeyboardShortcutsProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
