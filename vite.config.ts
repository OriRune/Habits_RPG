/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Habits RPG',
        short_name: 'HabitsRPG',
        description: 'A fantasy habit-tracker RPG.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#160c06',
        theme_color: '#160c06',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Intentionally NO runtimeCaching: Supabase is cross-origin (*.supabase.co);
        // with no matching route, all REST/realtime traffic falls through to network.
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own long-cached chunk so app
        // edits don't bust it. The minigame overlays/engines are code-split at the
        // React.lazy seams in App.tsx, so they get their own chunks automatically.
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          vendor: ['zustand', 'lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
