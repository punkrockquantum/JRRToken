import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dedicated port for the workshop fork (original app uses 5173/5180/5181).
    port: 5200,
    strictPort: true,
    // Polling survives environments where native macOS file events are
    // unavailable (e.g. sandboxed shells), preventing stale-module serving.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})
