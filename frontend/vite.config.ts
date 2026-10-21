import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split the large, rarely-changing vendor libraries so browsers can
        // cache them across application deploys. Page code stays in its own
        // lazy chunks via React.lazy. A function is used because ECharts and
        // React are consumed through subpath imports (echarts/core, etc.).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom') || id.includes('scheduler')) {
            return 'react'
          }
          if (id.includes('@tanstack')) return 'query'
          return undefined
        },
      },
    },
  },
})
