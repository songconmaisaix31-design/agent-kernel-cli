import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [mode, ...args] = process.argv.slice(2);
if (mode === 'success') {
  console.log(JSON.stringify({ ok: true, cwd: process.cwd(), args, stdin: readFileSync(0, 'utf8') }));
} else if (mode === 'failure') {
  console.error('intentional fixture failure');
  process.exitCode = 7;
} else if (mode === 'hang' || mode === 'grandchild') {
  console.log(JSON.stringify({ pid: process.pid, role: mode }));
  setInterval(() => {}, 1000);
} else if (mode === 'tree') {
  console.log(JSON.stringify({ pid: process.pid, role: 'parent' }));
  spawn(process.execPath, [import.meta.filename, 'branch'], { stdio: 'inherit' });
  setInterval(() => {}, 1000);
} else if (mode === 'branch') {
  console.log(JSON.stringify({ pid: process.pid, role: 'child' }));
  spawn(process.execPath, [import.meta.filename, 'grandchild'], { stdio: 'inherit' });
  setInterval(() => {}, 1000);
} else if (mode === 'orphan') {
  const child = spawn(process.execPath, [import.meta.filename, 'grandchild'], { stdio: 'inherit' });
  child.unref();
  setTimeout(() => process.exit(0), 1000);
} else throw new Error('Unknown fixture mode.');
