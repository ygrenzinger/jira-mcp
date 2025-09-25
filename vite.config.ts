import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  build: {
    target: 'node18',
    ssr: true,
    lib: {
      entry: {
        'server': resolve(__dirname, 'src/server.ts')
      },
      formats: ['es']
    },
    rollupOptions: {
      external: [
        '@modelcontextprotocol/sdk',
        'express',
        'zod',
        'node-fetch',
        'form-data',
        'mime-types',
        'node:https',
        'node:http',
        'node:fs',
        'node:path',
        'node:url',
        'node:crypto',
        'node:buffer',
        'node:stream',
        'node:util',
        'node:process',
        'https',
        'http',
        'fs',
        'path',
        'url',
        'crypto',
        'buffer',
        'stream',
        'util',
        'process',
        'async_hooks',
        'string_decoder'
      ],
      output: {
        dir: 'dist',
        entryFileNames: '[name].js',
        format: 'es',
        preserveModules: false
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true
  },
  esbuild: {
    platform: 'node'
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  optimizeDeps: {
    exclude: ['@modelcontextprotocol/sdk']
  }
})