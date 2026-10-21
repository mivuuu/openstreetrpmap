import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { mapStudioPlugin } from './vitePluginMapStudio.ts'

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'

  return {
    plugins: [
      react(),
      ...(isDev ? [mapStudioPlugin()] : []),
      {
        name: 'virtual-studio-module',
        resolveId(id) {
          if (id === 'virtual:studio') {
            return '\0virtual:studio'
          }
        },
        load(id) {
          if (id === '\0virtual:studio') {
            if (isDev) {
              const studioPath = path.resolve(process.cwd(), 'src/studio/StudioManager.tsx')
              return `
                export { StudioManager } from ${JSON.stringify(studioPath)};
                export const IS_STUDIO_BUILD = true;
              `
            }
            return `
              export function StudioManager() { return null; }
              export const IS_STUDIO_BUILD = false;
            `
          }
        },
      },
      {
        name: 'version-info-plugin',
        generateBundle() {
          let commitHash = 'unknown'
          try {
            commitHash = execSync('git rev-parse --short HEAD').toString().trim()
          } catch {
            // Ignore
          }
          this.emitFile({
            type: 'asset',
            fileName: 'build-info.json',
            source: JSON.stringify(
              {
                commit: commitHash,
                builtAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          })
        },
      },
    ],
    base: './',
  }
})
