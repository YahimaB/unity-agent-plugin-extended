#!/usr/bin/env node
// Builds the zip uploaded to OpenAI's plugin portal for a Codex release.
//
//   node scripts/build-codex-zip.mts            writes dist/unity-codex-<version>.zip
//
// Run it on a clean checkout of merged main, after the version bump. The zip holds one folder,
// `unity`, with the skills (no evals/ or tests/), both manifests, the README, the license and
// the logos the manifests reference. It refuses to build if the manifests disagree on
// the version or drift from scripts/plugin-metadata.json.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const meta: { version: string } = JSON.parse(
  readFileSync(join(root, 'scripts/plugin-metadata.json'), 'utf8'),
);

// 1. The manifests must already carry the release version.
execFileSync(process.execPath, [join(root, 'scripts/sync-manifests.mts'), '--check'], {
  cwd: root,
  stdio: 'inherit',
});
const manifests = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json'];
for (const file of manifests) {
  const { version } = JSON.parse(readFileSync(join(root, file), 'utf8')) as { version: string };
  if (version !== meta.version) fail(`${file} is at ${version}, expected ${meta.version}`);
}

// 2. Stage the package as <tmp>/unity.
const excluded = new Set(['evals', 'tests', '.DS_Store', 'Thumbs.db']);
const contents = [
  'skills',
  '.codex-plugin',
  '.claude-plugin',
  'README.md',
  'LICENSE.md',
  'assets/unity.svg',
  'assets/unity-small.svg',
  'assets/unity-tile.svg', // the icon .claude-plugin/plugin.json points to
];
const stage = mkdtempSync(join(tmpdir(), 'unity-codex-'));
const pkg = join(stage, 'unity');
try {
  for (const entry of contents) {
    const from = join(root, entry);
    if (!existsSync(from)) fail(`missing ${entry}`);
    cpSync(from, join(pkg, entry), {
      recursive: true,
      filter: (src) => !excluded.has(basename(src)),
    });
  }

  // 3. Check what was staged before zipping it.
  const skills = readdirSync(join(pkg, 'skills')).filter((d) =>
    existsSync(join(pkg, 'skills', d, 'SKILL.md')),
  );
  const codex = JSON.parse(readFileSync(join(pkg, '.codex-plugin/plugin.json'), 'utf8')) as {
    interface?: { logo?: string; composerIcon?: string };
  };
  const assets = [codex.interface?.logo, codex.interface?.composerIcon];
  for (const asset of assets.filter((a): a is string => typeof a === 'string')) {
    if (!existsSync(join(pkg, asset))) fail(`the Codex manifest references ${asset}, which is not in the package`);
  }

  // 4. Zip it. Windows and macOS ship bsdtar, which writes zip archives; Linux uses zip.
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const out = join(dist, `unity-codex-${meta.version}.zip`);
  rmSync(out, { force: true });
  if (process.platform === 'linux') {
    execFileSync('zip', ['-r', '-X', '-q', out, 'unity'], { cwd: stage, stdio: 'inherit' });
  } else {
    const tar =
      process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['--format', 'zip', '-cf', out, 'unity'], { cwd: stage, stdio: 'inherit' });
  }

  console.log(`Built ${out}`);
  console.log(`  version ${meta.version}, ${skills.length} skills, ${(statSync(out).size / 1024).toFixed(0)} KB`);
  console.log('Next: upload it at https://platform.openai.com/plugins (Upload plugin to make changes).');
} finally {
  rmSync(stage, { recursive: true, force: true });
}

function fail(message: string): never {
  console.error(`build-codex-zip: ${message}`);
  process.exit(1);
}
