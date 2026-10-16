// Package the isolated lab and the exact owning SQL/publisher files.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: false });
for (const name of ['public-lab/run.ts', 'lib/portal/publish.ts', 'lib/contracts.ts', 'db/01_core.sql', 'db/02_portal_voice.sql', 'db/03_publish_jobs.sql']) {
  mkdirSync(dirname(resolve(output, name)), { recursive: true }); cpSync(resolve(root, name), resolve(output, name));
}
cpSync(resolve(root, 'public-lab/site'), resolve(output, 'site'), { recursive: true });
cpSync(resolve(root, 'public-lab/package.json'), resolve(output, 'package.json'));
cpSync(resolve(root, 'public-lab/package-lock.json'), resolve(output, 'package-lock.json'));
mkdirSync(resolve(output, 'api'), { recursive: true });
execFileSync('pnpm', ['dlx', 'esbuild@0.28.2', resolve(root, 'api/public-demo.ts'), '--bundle', '--platform=node', '--format=esm', '--target=node24', '--external:@electric-sql/pglite', `--outfile=${resolve(output, 'api/public-demo.mjs')}`], { stdio: 'inherit' });
writeFileSync(resolve(output, 'vercel.json'), JSON.stringify({ buildCommand: '', outputDirectory: 'site', functions: { 'api/public-demo.mjs': { maxDuration: 15, includeFiles: '{db/**,node_modules/@electric-sql/pglite/dist/**}' } } }, null, 2));
