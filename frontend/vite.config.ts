import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite configuration for the ScribeAI frontend. This config exposes
// a separate development port (3030) so it can run alongside the
// backend server locally. We also set up an alias so that imports
// beginning with '@/...' resolve to the src/ directory. This keeps
// import statements tidy and consistent.

export default defineConfig(({ mode }) => {
  // Load environment variables prefixed with VITE_ from .env files.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      port: 3030,
      proxy: {
      "/api": {
        target: "http://localhost:3003",
        changeOrigin: true,
      },
    },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    }
  };
});


