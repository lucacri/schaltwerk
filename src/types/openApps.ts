export type OpenAppKind = 'editor' | 'terminal' | 'system'

export interface OpenApp {
  id: string
  name: string
  kind: OpenAppKind
}

export interface OpenAppCatalogEntry extends OpenApp {
  is_detected: boolean
  is_enabled: boolean
  is_default: boolean
}
