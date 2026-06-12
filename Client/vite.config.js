import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
      //  target: 'http://127.0.0.1:5000',
      //  target: 'http://192.168.50.40:5000',
      target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },


  },
});