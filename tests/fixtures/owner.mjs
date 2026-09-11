import { launchWindows } from '../../dist/windows-process.js';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const directory = process.argv[2];
writeFileSync(join(directory, 'prompt.txt'), '');
const child = launchWindows({ agent: 'program', cwd: directory, executable: process.execPath,
  args: [resolve('tests/fixtures/program.mjs'), 'tree'], prompt: '', timeoutMs: 15_000, outputLimitBytes: 100_000 },
directory, pid => console.log(JSON.stringify({ childPid: pid })));
await child.done;
