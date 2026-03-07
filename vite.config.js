import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(__dirname);
const submoduleDir = path.resolve(__dirname, 'deck.gl-raster');
const require = createRequire(import.meta.url);

// Determine if we're building the library or the example
const isLibraryBuild = process.env.BUILD_MODE === 'library';

const pkgDir = (name) => {
  let dir = path.dirname(require.resolve(name));
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }

  throw new Error(`Unable to resolve package root for ${name}`);
};

export default defineConfig(
  isLibraryBuild
    ? {
        // Library build configuration
        build: {
          lib: {
            entry: path.resolve(projectDir, 'src/index.js'),
            name: 'DeckGLRasterMultiband',
            fileName: (format) => `deck.gl-raster-multiband.${format}.js`,
            formats: ['es', 'cjs'],
          },
          outDir: path.resolve(projectDir, 'dist'),
          emptyOutDir: true,
          target: 'esnext',
          rollupOptions: {
            external: ['gpu.js', 'proj4'],
          },
        },
        esbuild: {
          target: 'esnext',
        },
      }
    : {
        // Example app build configuration
        root: path.resolve(projectDir, 'example'),
        base: '/deckglraster-multiband/',
        resolve: {
          dedupe: [
            '@deck.gl/core',
            '@deck.gl/extensions',
            '@deck.gl/geo-layers',
            '@deck.gl/layers',
            '@deck.gl/mapbox',
            '@deck.gl/mesh-layers',
            '@luma.gl/constants',
            '@luma.gl/core',
            '@luma.gl/engine',
            '@luma.gl/gltf',
            '@luma.gl/shadertools',
            '@luma.gl/webgl',
          ],
          alias: {
            child_process: path.resolve(projectDir, 'example/shims/child-process.js'),
            'node:child_process': path.resolve(projectDir, 'example/shims/child-process.js'),
            '@deck.gl/core': pkgDir('@deck.gl/core'),
            '@deck.gl/extensions': pkgDir('@deck.gl/extensions'),
            '@deck.gl/geo-layers': pkgDir('@deck.gl/geo-layers'),
            '@deck.gl/layers': pkgDir('@deck.gl/layers'),
            '@deck.gl/mapbox': pkgDir('@deck.gl/mapbox'),
            '@deck.gl/mesh-layers': pkgDir('@deck.gl/mesh-layers'),
            '@luma.gl/constants': pkgDir('@luma.gl/constants'),
            '@luma.gl/core': pkgDir('@luma.gl/core'),
            '@luma.gl/engine': pkgDir('@luma.gl/engine'),
            '@luma.gl/gltf': pkgDir('@luma.gl/gltf'),
            '@luma.gl/shadertools': pkgDir('@luma.gl/shadertools'),
            '@luma.gl/webgl': pkgDir('@luma.gl/webgl'),
          },
        },
        build: {
          outDir: path.resolve(projectDir, 'example/dist'),
          emptyOutDir: true,
          target: 'esnext',
          chunkSizeWarningLimit: 2500,
        },
        esbuild: {
          target: 'esnext',
        },
        optimizeDeps: {
          esbuildOptions: {
            target: 'esnext',
          },
        },
        worker: {
          format: 'es',
        },
        server: {
          fs: {
            allow: [projectDir, submoduleDir],
          },
        },
        preview: {
          port: 4173,
        },
      }
);
