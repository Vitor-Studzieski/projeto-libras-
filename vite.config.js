import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = Number(process.env.LIBRAS_API_PORT || env.LIBRAS_API_PORT || 8787)
  const webPort = Number(process.env.VITE_PORT || env.VITE_PORT || 5173)

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: webPort,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
