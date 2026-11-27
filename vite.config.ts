import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  // GitHub Actions supplies GITHUB_REPOSITORY as owner/repository.
  // Local development and custom-domain deployments use '/'.
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  const base = command === 'build' && process.env.GITHUB_ACTIONS === 'true' && repo && repo.toLowerCase() !== `${process.env.GITHUB_REPOSITORY?.split('/')[0]}.github.io`.toLowerCase()
    ? `/${repo}/`
    : '/';
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      // Preload only the two primary font faces needed for first paint, respecting Vite base.
      {
        name: 'preload-first-paint-fonts',
        apply: 'build',
        transformIndexHtml: {
          order: 'post',
          handler(_html, ctx) {
            if (!ctx.bundle) return [];
            const targets = [
              /plus-jakarta-sans-latin-400-normal-.*\.woff2$/,
              /eb-garamond-latin-400-normal-.*\.woff2$/,
            ];
            const tags = [];
            for (const fileName of Object.keys(ctx.bundle)) {
              if (targets.some((re) => re.test(fileName))) {
                const href = `${base.endsWith('/') ? base : `${base}/`}${fileName.replace(/^\/+/, '')}`;
                tags.push({
                  tag: 'link',
                  attrs: {
                    rel: 'preload',
                    as: 'font',
                    type: 'font/woff2',
                    crossorigin: true,
                    href,
                  },
                  injectTo: 'head' as const,
                });
              }
            }
            return tags;
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
