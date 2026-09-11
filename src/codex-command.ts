import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { processEnvironment } from './process-environment.js';
import { resolveProgram } from './task-command.js';

const execute = promisify(execFile);
export function codexArguments(): string[] {
  return ['--ask-for-approval', 'never', 'exec', '--sandbox', 'read-only', '--json', '--ephemeral', '--color', 'never', '-'];
}

export async function prepareCodex(): Promise<{ executable: string; args: string[] }> {
  let executable: string;
  let prefix: string[] = [];
  if (process.env.AGENT_KERNEL_CODEX_BIN) executable = resolveProgram(process.env.AGENT_KERNEL_CODEX_BIN);
  else {
    try { executable = resolveProgram('codex'); }
    catch {
      const entry = (process.env.PATH ?? '').split(delimiter)
        .map(directory => join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'))
        .find(file => existsSync(file));
      if (!entry) throw new Error('Installed Codex CLI not found. Set AGENT_KERNEL_CODEX_BIN to the existing native executable; this CLI does not install or purchase anything.');
      executable = process.execPath;
      prefix = [entry];
    }
  }
  const login = await execute(executable, [...prefix, 'login', 'status'], { env: processEnvironment(), windowsHide: true, timeout: 15_000, maxBuffer: 64_000 });
  if (!/Logged in using ChatGPT/i.test(login.stdout + login.stderr)) {
    throw new Error('An existing ChatGPT login is required. API-key billing and automatic login are not enabled.');
  }
  return { executable, args: [...prefix, ...codexArguments()] };
}

export function readCodexResult(file: string): { text: string; threadId: string; usage: unknown; warnings: string[] } {
  const lines = readFileSync(file, 'utf8').split('\n').filter(line => line.trim());
  let text = '', threadId = '', completed = false, failed = false, usage: unknown = null;
  const warnings: string[] = [];
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type === 'thread.started') threadId = event.thread_id;
    if (event.type === 'turn.failed') failed = true;
    if (event.type === 'error' && typeof event.message === 'string') warnings.push(event.message);
    if (event.type === 'turn.completed') { completed = true; usage = event.usage; }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text;
  }
  if (failed || !completed || !threadId || typeof text !== 'string' || !text.trim()) {
    throw new Error('Codex did not emit a successful completed turn with a final message. Inspect stdout/stderr; no automatic retry.');
  }
  let answer: unknown;
  try { answer = JSON.parse(text); } catch { /* Plain final messages are also supported. */ }
  if (answer && typeof answer === 'object' && 'error' in answer) {
    throw new Error(`Codex task reported failure: ${String(answer.error)}`);
  }
  return { text, threadId, usage, warnings };
}
