const esbuild = require('esbuild')

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true
}

if (watch) {
  esbuild.context(options).then((ctx) => ctx.watch())
} else {
  esbuild.build(options).catch(() => process.exit(1))
}
