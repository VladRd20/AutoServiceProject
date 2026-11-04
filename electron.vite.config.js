import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Dependintele din node_modules raman externe (build.externalizeDeps e activ implicit
// in electron-vite 5 pentru main/preload; externalizeDepsPlugin e depreciat).
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Worker-ul de generare PDF e un entry separat (utilityProcess.fork pe out/main/pdfWorker.js)
        input: {
          index: resolve('src/main/index.js'),
          pdfWorker: resolve('src/main/pdfWorker.js')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
