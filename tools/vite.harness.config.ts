// Dev-only: the design harness in a git worktree whose node_modules is a symlink to the main
// checkout. Vite's fs guard would 403 the fonts; allow the repository root as well.
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

export default mergeConfig(base({ mode: 'development', command: 'serve' } as never) as object, defineConfig({ server: { fs: { allow: ['..', '../../..', '/Users/mutaafaziz/Desktop/projects/kin'] } } }));
