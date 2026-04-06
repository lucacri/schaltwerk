import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider, createStore } from 'jotai'
import './index.css'
import { setThemeActionAtom, initializeThemeActionAtom } from './store/atoms/theme'
import { StyleGuide } from './style-guide/StyleGuide'
import { applyStyleGuideTheme, installStyleGuideTauriMock, resolveInitialStyleGuideTheme, resolveStyleGuideThemeId } from './style-guide/mocks'

const root = document.getElementById('root')!
const reactRoot = ReactDOM.createRoot(root)
const store = createStore()
const initialTheme = resolveInitialStyleGuideTheme()

installStyleGuideTauriMock(initialTheme)
applyStyleGuideTheme(resolveStyleGuideThemeId(initialTheme))
void store.set(initializeThemeActionAtom).then(async () => {
  await store.set(setThemeActionAtom, initialTheme)
  applyStyleGuideTheme(resolveStyleGuideThemeId(initialTheme))
})

reactRoot.render(
  <React.StrictMode>
    <JotaiProvider store={store}>
      <StyleGuide />
    </JotaiProvider>
  </React.StrictMode>,
)
