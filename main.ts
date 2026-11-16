// Launch Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every protocol with the model in
// lib/model.ts, writes the ranked board and the dashboard's data, copies
// dashboard/ and screenshots/ into the output, and writes the dossier with
// the vendored make.fun library. The program runs twice and both runs write
// the same bytes: the model is a pure function of the snapshot.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = dirname(fileURLToPath(import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

/** --name <value> (or --name=<value>) out of the arguments, or the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy a directory's files into `to`, skipping dot-names, recursing into
 *  subdirectories. Returns the number of files copied. */
function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (statSync(path).isDirectory()) {
      copied += copyTree(path, join(to, name));
    } else if (statSync(path).isFile()) {
      copyFileSync(path, join(to, name));
      copied += 1;
    }
  }
  return copied;
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));
copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shots < 3) fail(`screenshots/ holds ${shots} image${shots === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

const excluded = radar.rows.filter((r) => r.shape_excluded).length;
process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} pre-token rows ranked (${excluded} flagged by the watchlist rule's shape test), ${radar.live.length} trading protocols set aside\n` +
    `launch radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')}, ${join(outDir, 'screenshots')} (${shots} images) and ${join(outDir, 'dossier.json')}\n`,
);
