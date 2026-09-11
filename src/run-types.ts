export type Phase = 'starting' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'stopped' | 'timed_out' | 'unverifiable';
export interface TaskInput {
  agent: 'program' | 'codex';
  cwd: string;
  prompt: string;
  executable: string;
  args: string[];
  timeoutMs: number;
  outputLimitBytes: number;
}
export interface RunState {
  id: string;
  agent: TaskInput['agent'];
  cwd: string;
  host: string;
  platform: string;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  supervisorPid?: number;
  childPid?: number;
  exitCode?: number | null;
  reason?: string;
  liveness: 'live' | 'unverifiable' | 'exited';
  result?: string;
}
export interface ProcessResult {
  reason: string;
  exitCode: number | null;
  verified: boolean;
  remaining: number;
  detail?: string;
}
export const settled = (state: RunState): boolean => ['succeeded', 'failed', 'stopped', 'timed_out'].includes(state.phase);
