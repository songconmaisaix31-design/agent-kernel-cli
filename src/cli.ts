#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseLimits } from './duration-policy.js';
import { activeId, readState } from './run-store.js';
import { readResult, startTask, stopTask } from './task-lifecycle.js';
import { resolveCwd, resolveProgram } from './task-command.js';

const help = `agent-kernel (local prototype)
  start --agent program --cwd <folder> [--timeout-ms <ms>] -- <executable> [args...]
  status [task-id] [--store <folder>]
  stop <task-id> [--store <folder>]
  result <task-id> [--store <folder>]
Default store: ~/.agent-kernel-cli. All responses are JSON.
start returns an ID; starting does not mean the agent has begun.
Program mode runs a trusted local program without a shell or sandbox.
Windows only for execution in this milestone; no remote execution.`;

try {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log(help);
  } else {
    const separator = argv.indexOf('--');
    const program = separator === -1 ? [] : argv.slice(separator + 1);
    const { values, positionals } = parseArgs({
      args: separator === -1 ? argv : argv.slice(0, separator), allowPositionals: true,
      options: {
        store: { type: 'string', default: join(homedir(), '.agent-kernel-cli') },
        agent: { type: 'string', default: 'program' }, cwd: { type: 'string' },
        'timeout-ms': { type: 'string' }, prompt: { type: 'string' }, 'prompt-file': { type: 'string' }
      }
    });
    const store = values.store;
    if (command === 'start') {
      if (positionals.length || values.agent !== 'program' || !values.cwd || !program[0]) throw new Error(help);
      if (values.prompt !== undefined && values['prompt-file'] !== undefined) throw new Error('Choose prompt or prompt-file.');
      const prompt = values['prompt-file'] ? readFileSync(values['prompt-file'], 'utf8') : values.prompt ?? '';
      const limits = parseLimits(values['timeout-ms'] === undefined ? {} : { timeoutMs: Number(values['timeout-ms']) });
      const state = await startTask(store, { agent: 'program', cwd: resolveCwd(values.cwd), executable: resolveProgram(program[0]), args: program.slice(1), prompt, ...limits });
      console.log(JSON.stringify(state, null, 2));
    } else if (['status', 'stop', 'result'].includes(command)) {
      if (positionals.length > 1 || program.length) throw new Error('Expected at most one task ID.');
      const id = positionals[0] ?? (command === 'status' ? activeId(store) : undefined);
      if (!id && command !== 'status') throw new Error('Task ID required.');
      const result = !id ? { phase: 'idle' }
        : command === 'status' ? readState(store, id)
        : command === 'stop' ? await stopTask(store, id) : readResult(store, id);
      console.log(JSON.stringify(result, null, 2));
      const phase = 'state' in result ? result.state.phase : result.phase;
      if (command !== 'status' && ['failed', 'timed_out', 'unverifiable', 'starting', 'running', 'stopping'].includes(phase)) process.exitCode = 1;
    } else throw new Error(help);
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
