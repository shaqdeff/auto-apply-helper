import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// Background and content scripts go to dist/ (referenced from manifest).
// Popup and options bundles go next to their HTML files so the relative
// <script src="popup.js"> tag in the HTML resolves correctly.
const buildConfigs = [
  {
    entryPoints: { content: 'src/content/index.ts' },
    outdir: 'dist',
  },
  {
    entryPoints: { background: 'src/background/index.ts' },
    outdir: 'dist',
  },
  {
    entryPoints: { popup: 'src/popup/popup.ts' },
    outdir: 'src/popup',
  },
  {
    entryPoints: { options: 'src/options/options.ts' },
    outdir: 'src/options',
  },
];

const sharedOptions = {
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  for (const config of buildConfigs) {
    const ctx = await esbuild.context({ ...sharedOptions, ...config });
    await ctx.watch();
  }
  console.log('Watching for changes…');
} else {
  for (const config of buildConfigs) {
    await esbuild.build({ ...sharedOptions, ...config });
  }
  console.log('Build complete.');
}
