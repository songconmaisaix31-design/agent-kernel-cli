import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from './run-store.js';
import { processEnvironment } from './process-environment.js';
import type { ProcessResult, TaskInput } from './run-types.js';

export function launchWindows(task: TaskInput, directory: string, onStarted: (pid: number) => void) {
  if (process.platform !== 'win32') throw new Error('This prototype requires Windows. Linux process ownership awaits VM acceptance.');
  const specPath = join(directory, 'process.json');
  writeJson(specPath, {
    executable: task.executable, args: task.args, cwd: task.cwd,
    timeoutMs: task.timeoutMs, outputLimitBytes: task.outputLimitBytes,
    stdinPath: join(directory, 'prompt.txt'), stdoutPath: join(directory, 'stdout.log'), stderrPath: join(directory, 'stderr.log')
  });
  const stderr = openSync(join(directory, 'runner-stderr.log'), 'a', 0o600);
  const runner = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows/job.ps1', import.meta.url)), '-SpecPath', specPath],
    { windowsHide: true, stdio: ['pipe', 'pipe', stderr], env: processEnvironment() });
  closeSync(stderr);
  let last: ProcessResult | undefined;
  let buffer = '';
  const input = runner.stdin!;
  const output = runner.stdout!;
  input.on('error', () => {});
  const watchdog = setTimeout(() => { input.end('stop\n'); }, task.timeoutMs + 15_000);
  const lastResort = setTimeout(() => { runner.kill(); }, task.timeoutMs + 25_000);
  runner.once('close', () => { clearTimeout(watchdog); clearTimeout(lastResort); });
  const done = new Promise<ProcessResult>((resolve) => {
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      appendFileSync(join(directory, 'runner.jsonl'), chunk);
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'started' && Number.isSafeInteger(event.pid) && event.pid > 0) onStarted(event.pid);
          if (event.type === 'exited' && typeof event.reason === 'string' && typeof event.verified === 'boolean' && Number.isSafeInteger(event.remaining)) last = event;
        } catch { /* A malformed runner receipt cannot establish process exit. */ }
      }
    });
    runner.once('error', (error) => resolve({ reason: 'runner_launch_failed', detail: error.message, exitCode: null, remaining: 0, verified: true }));
    runner.once('close', () => resolve(last ?? { reason: 'runner_receipt_missing', exitCode: null, remaining: -1, verified: false }));
  });
  return { done, stop: () => { if (input.writable) input.end('stop\n'); } };
}
