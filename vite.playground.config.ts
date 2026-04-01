import { defineConfig, mergeConfig } from "vite"
import baseConfigFn from "./vite.config"
import path from "path"

export default defineConfig((env) => {
  const base = typeof baseConfigFn === 'function' ? baseConfigFn(env) : baseConfigFn

  return mergeConfig(base, {
    root: 'playground',
    server: {
      port: 1421,
      strictPort: true,
      hmr: undefined,
    },
    resolve: {
      alias: {
        '@tauri-apps/api/core': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/api/event': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/plugin-shell': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/plugin-process': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/plugin-os': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/plugin-updater': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/plugin-notification': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/api/window': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/api/webview': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/api/dpi': path.resolve(__dirname, 'playground/mockTauri.ts'),
        '@tauri-apps/api/path': path.resolve(__dirname, 'playground/mockTauri.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, 'playground/index.html'),
        output: { manualChunks: undefined },
      },
    },
  })
})
