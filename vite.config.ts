import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

function webVendorChunk(
  moduleId: string,
): string | undefined {
  const id =
    moduleId.replace(
      /\\/g,
      '/',
    );

  if (
    id.includes(
      '/node_modules/react/',
    ) ||
    id.includes(
      '/node_modules/react-dom/',
    ) ||
    id.includes(
      '/node_modules/scheduler/',
    )
  ) {
    return 'vendor-react';
  }

  return undefined;
}

export default defineConfig(
  () => {
    return {
      plugins: [
        react(),
        tailwindcss(),
      ],

      resolve: {
        alias: {
          '@':
            path.resolve(
              __dirname,
              '.',
            ),
        },
      },

      build: {
        rollupOptions: {
          output: {
            manualChunks:
              webVendorChunk,
          },
        },
      },

      server: {
        /*
         * HMR can be disabled in constrained agent environments.
         * File watching follows the same switch to avoid needless CPU.
         */
        hmr:
          process.env.DISABLE_HMR !==
          'true',

        watch:
          process.env.DISABLE_HMR ===
          'true'
            ? null
            : {},
      },
    };
  },
);
