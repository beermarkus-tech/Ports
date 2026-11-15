import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Build number = number of commits on the branch; increases by one per commit. */
function git(cmd: string, fallback: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}
const buildNumber = git('rev-list --count HEAD', '0');
const buildSha = git('rev-parse --short HEAD', 'dev');

// Relative base so the build works at any path: GitHub Pages serves it from
// /<repo>/, a custom domain from /, and `vite preview` from /.
export default defineConfig({
  base: './',
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    VitePWA({
      // The game saves after every action (a voyage is resolved and saved before
      // it is animated), so silently activating a new version is safe.
      // Registration happens in src/ui/update.ts (it also drives the reload button).
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Deadweight: shipping company',
        short_name: 'Deadweight',
        description: 'Start with one old coaster and build a global shipping company.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#08131f',
        theme_color: '#0a1626',
        categories: ['games', 'strategy'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Precache everything so the game is fully playable offline.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
