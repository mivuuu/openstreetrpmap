/// <reference types="vite/client" />

declare module 'virtual:studio' {
  import type { ComponentType } from 'react'
  import type { Map } from 'maplibre-gl'
  export const StudioManager: ComponentType<{ map: Map | null; onExit: () => void }>
  export const IS_STUDIO_BUILD: boolean
}
