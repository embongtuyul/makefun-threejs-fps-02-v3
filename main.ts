// SANDLINE — make.fun threejs-fps-02 entry program (Node 22+, stdlib only).
//
// Hands the game in: copies game/ and screenshots/ from this repository into
// the output directory and writes dossier.json with buildDossier from the
// kit's library (vendor/makefun-threejs.ts, unchanged). Runs twice by the
// grader; both runs must write the same bytes, so this does nothing but copy
// files and build the dossier from them — no timestamps, no randomness.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function copyClean(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

// Fail fast with a clear message when the entry is incomplete, instead of
// handing the grader a half-copied output directory.
for (const dir of ['game', 'screenshots']) {
  if (!existsSync(join(REPO_DIR, dir))) {
    throw new Error(`SANDLINE entry is missing ${dir}/ — nothing to hand in`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
copyClean(join(REPO_DIR, 'game'), join(OUT_DIR, 'game'));
copyClean(join(REPO_DIR, 'screenshots'), join(OUT_DIR, 'screenshots'));

writeFileSync(
  join(OUT_DIR, 'dossier.json'),
  buildDossier(OUT_DIR, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
