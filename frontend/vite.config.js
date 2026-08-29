import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Kept off: this project writes plain CSS with no framework, and minifying
    // it has caused visual regressions here before. The CSS ships gzipped by
    // the host either way.
    cssMinify: false,
    rollupOptions: {
      output: {
        // React and the router change far less often than app code, so keeping
        // them in their own chunk lets a returning visitor reuse the cached copy
        // across deploys instead of re-downloading it inside the app bundle.
        //
        // Written as a function rather than the object form: Vite 8 runs on
        // rolldown, which only accepts the function signature here.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
