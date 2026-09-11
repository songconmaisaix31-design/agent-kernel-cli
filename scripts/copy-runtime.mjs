import { cpSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../dist/windows/', import.meta.url), { recursive: true });
for (const file of ['job.cs', 'job.ps1']) {
  cpSync(new URL(`../src/windows/${file}`, import.meta.url), new URL(`../dist/windows/${file}`, import.meta.url));
}
