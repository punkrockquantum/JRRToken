import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Polling survives environments where native macOS file events are
    // unavailable (e.g. sandboxed shells), preventing stale-module serving.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})
