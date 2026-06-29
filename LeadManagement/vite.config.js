import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Capture the current git branch when the dev server / build starts, so the
// in-app DevBadge can show which worktree/branch is being served. Only used in
// DEV (the badge is hidden in production builds), so this value is harmless in
// the Netlify build even if it resolves to 'main' / 'unknown' there.
let gitBranch = 'unknown';
try {
  gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
} catch { /* git not available — leave as 'unknown' */ }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BRANCH__: JSON.stringify(gitBranch),
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
