<div align="center">

# agent-kernel-cli

Run one local task, query its state, stop the process tree it owns, and read back what actually happened. Windows only, no daemon.

在本机跑一个任务、查它的状态、停掉它拥有的整棵进程树、再回读到底发生了什么。仅 Windows，无后台服务。

![Node](https://img.shields.io/badge/node-%3E%3D24-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

</div>

> **How to read this page / 怎么读这页**
> English first, then the same content in Chinese — not a summary, not a separate half.
> 每段英文在前、同一内容的中文紧跟在后；不是摘要，也没有单独的"中文版"。

---

## At a glance · 一眼看懂

| | |
|---|---|
| **Problem<br/>问题** | You start a local agent process and lose the ability to answer three questions: is it still running, did it really finish, and did anything it spawned survive.<br/>启动一个本地 Agent 进程之后，三个问题就答不上来了：它还在跑吗、它真的跑完了吗、它派生的东西还有活着的吗。 |
| **Fix<br/>做法** | A CLI that writes a JSON run record per task, keeps one task per store, and stops through a Windows Job object so the whole tree dies together. Every response is JSON on stdout.<br/>一个 CLI：每个任务写一份 JSON 记录，一个 store 同时只跑一个任务，停止走 Windows Job 对象，整棵树一起结束。每次响应都是 stdout 上的 JSON。 |
| **Cost<br/>代价** | Node 24+, pnpm 10.24.0, a TypeScript build step. Zero runtime npm dependencies. Codex mode additionally reuses an already-logged-in ChatGPT account; it does not accept an API key.<br/>需要 Node 24+、pnpm 10.24.0、一步 TypeScript 构建。运行时零 npm 依赖。Codex 模式额外复用已登录的 ChatGPT 账号，不接受 API Key。 |
| **Not<br/>不是** | Not a sandbox, not an orchestrator, not a queue. Program mode runs trusted programs only, and the Windows Job is a process boundary, not a file or network boundary.<br/>不是沙箱、不是编排器、不是队列。普通程序模式只跑受信任的程序，Windows Job 是进程边界，不是文件或网络边界。 |

## The problem · 问题在哪

A child process is easy to start and hard to account for. Four failure modes show up immediately:

起一个子进程很容易，说清它到底怎么了很难。四种失败模式一上来就会遇到：

```text
start a detached child
├── it exits 0 but wrote an error into the record   → success or failure?
├── it times out, but a grandchild keeps the pipe open → is it gone?
├── the supervisor dies                              → who owns the run now?
└── a stale record names a PID that was reused       → is stopping it safe?
```

Each question has a cheap wrong answer. "Exit code 0 means success" is wrong when the agent reports a structured error. "Kill the PID" is wrong when the PID has been recycled. "The process is gone" is wrong when a descendant still holds the pipe.

每个问题都有一个便宜的错误答案。Agent 报了结构化错误时，"退出码 0 就是成功"是错的；PID 被复用时，"杀掉那个 PID"是错的；后代进程还握着管道时，"进程没了"是错的。

This CLI exists to make those three answers explicit instead of assumed: a phase machine ending in `unverifiable` rather than a guess, hostname and PID checks before any PID-based stop, and a Job object that owns the tree.

这个 CLI 的作用就是让这三个答案变成显式的、而不是假设的：一台以 `unverifiable` 收尾而不是靠猜的状态机；任何基于 PID 的停止之前先校验主机名与 PID；以及一个拥有整棵树的 Job 对象。

## The idea · 思路

Five nouns, each with one testable rule.

五个名词，每个配一条可检验的规则。

| Noun · 名词 | Where · 位置 | Rule · 规则 |
|---|---|---|
| **Store** | `src/run-store.ts` | One directory, default `~/.agent-kernel-cli`. Writes are atomic: temp file plus rename, with bounded retries on Windows `EPERM`/`EACCES`/`EBUSY`; POSIX errors are not retried.<br/>一个目录，默认 `~/.agent-kernel-cli`。写入是原子的：临时文件加重命名，Windows 的 `EPERM`/`EACCES`/`EBUSY` 有次数上限的重试；POSIX 错误不重试。 |
| **Task** | `src/task-lifecycle.ts` | One store runs at most one task. A second `start` against an owned store is refused, not queued.<br/>一个 store 同时最多跑一个任务。对已被占用的 store 再 `start` 会被拒绝，不会排队。 |
| **Phase** | `src/run-types.ts` | Eight phases: `starting`, `running`, `stopping`, `succeeded`, `failed`, `stopped`, `timed_out`, `unverifiable`. `starting` never means "began".<br/>八个状态：`starting`、`running`、`stopping`、`succeeded`、`failed`、`stopped`、`timed_out`、`unverifiable`。`starting` 从来不等于"已经开始"。 |
| **Job** | `src/windows-process.ts`, `src/windows/job.cs` | The task runs inside a Windows Job object with no breakaway, so `stop` terminates the tree it actually created.<br/>任务跑在一个不允许 breakaway 的 Windows Job 对象里，所以 `stop` 终止的是它真正创建出来的那棵树。 |
| **Boundary** | `src/process-environment.ts`, `src/codex-command.ts` | The child never inherits `ORCA_*`, `CODEX_*` session keys or `OPENAI_API_KEY`; Codex always runs read-only with approval escalation denied.<br/>子进程绝不继承 `ORCA_*`、`CODEX_*` 会话键或 `OPENAI_API_KEY`；Codex 一律以只读运行，并拒绝权限升级。 |

One test you can run to check the claim: `stop` a task that spawned a grandchild and confirm the sentinel process outside the Job is still alive. That is what `tests/lifecycle.test.mjs` does.

可以立刻做的验证：`stop` 一个派生过孙进程的任务，确认 Job 之外的哨兵进程仍然活着。`tests/lifecycle.test.mjs` 做的就是这件事。

## Capabilities · 能力清单

Four commands. `--store <folder>` applies to all of them.

四个命令。`--store <目录>` 对全部生效。

| Command · 命令 | What it does · 做什么 | Exit behaviour · 退出行为 |
|---|---|---|
| `start` | `--agent program --cwd <dir> -- <exe> [args]`, or `--agent codex --cwd <dir> --prompt <text>` / `--prompt-file <path>`. Returns the task ID as JSON.<br/>两种形态：`--agent program --cwd <dir> -- <exe> [args]`，或 `--agent codex --cwd <dir> --prompt <文本>` / `--prompt-file <路径>`。以 JSON 返回任务 ID。 | Non-zero on invalid arguments<br/>参数非法时非零 |
| `status [id]` | Reads the run record. With no ID, reports the active task, or `{"phase":"idle"}`.<br/>读运行记录。不给 ID 时报告当前活动任务，没有则为 `{"phase":"idle"}`。 | Always `0`<br/>总是 `0` |
| `stop <id>` | Terminates the process tree inside the task's Job.<br/>终止该任务 Job 内的整棵进程树。 | Non-zero when the phase is not terminal<br/>状态非终态时非零 |
| `result <id>` | Reads the final output and exit result.<br/>读最终输出与退出结果。 | Non-zero for `failed`, `timed_out`, `unverifiable`, and non-terminal phases<br/>`failed`、`timed_out`、`unverifiable` 及非终态时非零 |

Codex mode constraints, all enforced in code rather than by convention: prompt length capped at 64,000 characters; prompt or prompt-file, not both; `--ask-for-approval never exec --sandbox read-only --json --ephemeral --color never` plus `--permission-profile :read-only`; binary resolved from `AGENT_KERNEL_CODEX_BIN` or a PATH lookup; no credential copying, no login automation, no API-key billing.

Codex 模式的约束都写在代码里而不是靠约定：prompt 上限 64,000 字符；prompt 与 prompt-file 二选一；固定 `--ask-for-approval never exec --sandbox read-only --json --ephemeral --color never` 加 `--permission-profile :read-only`；二进制从 `AGENT_KERNEL_CODEX_BIN` 或 PATH 解析；不复制凭据、不自动登录、不走 API Key 计费。

## Quickstart · 快速开始

### Requirements · 环境要求

Windows. Node 24 or newer, pnpm 10.24.0. No runtime npm dependencies; the build needs TypeScript.

Windows。Node 24 及以上、pnpm 10.24.0。运行时零 npm 依赖；构建需要 TypeScript。

### 1. Build · 构建

```bash
pnpm install --frozen-lockfile
pnpm build          # tsc + copies src/windows/{job.cs,job.ps1} into dist/windows
```

### 2. Run a program task · 跑一个普通程序任务

```bash
task=$(node dist/cli.js start --agent program --cwd . -- node tests/fixtures/program.mjs success)
node dist/cli.js status "$task"
node dist/cli.js result "$task"
```

`start` prints a JSON object; `status` moves from `starting` to `running` and then to a terminal phase. `result` exits non-zero if the task did not finish successfully.

`start` 打印一个 JSON 对象；`status` 会从 `starting` 走到 `running`，再走到某个终态。任务没有成功结束时，`result` 以非零码退出。

### 3. Verify · 验证

```bash
pnpm test           # node --test --test-concurrency=1 tests/*.test.mjs
```

> The commands above are copied from `package.json`, `src/cli.ts` and the previous README. They were **not re-executed while rewriting this page** — no install and no build were run. Treat them as unverified until one successful local run.<br/>
> 上面的命令摘自 `package.json`、`src/cli.ts` 与上一版 README。改写本页时**没有重新执行**——没装依赖、没跑构建。请以一次成功的本地运行为准，在那之前都算未验证。

## What has actually been recorded · 已记录的真实结果

This section separates what was measured from what was hoped. Every row is a record kept in the repository or in the previous README, not a fresh run.

这一节把"测过的"和"希望是的"分开。每一行都是仓库里或上一版 README 留下的记录，不是本次新跑的。

| Item · 项目 | Recorded outcome · 记录结果 | Where · 出处 |
|---|---|---|
| Product test run<br/>产品测试 | **37/37 passing** was recorded after the bounded-rename fix. The current tree declares **20 `test(...)` cases in 8 files**; the two numbers differ, so the 37 may include subtests. Neither was re-run for this page.<br/>修复有界重命名后记录为 **37/37 通过**。当前代码树在 8 个文件里声明了 **20 个 `test(...)` 用例**；两个数字不一致，37 可能包含子测试。本次两者都没有重跑。 | `tests/`, previous README<br/>`tests/`、上一版 README |
| Sandbox acceptance script<br/>沙箱验收脚本 | **19 deterministic checks passed**, then **26/26** after adding real argv/cwd passing and redaction checks.<br/>先 **19 项确定性检查通过**，补入真实参数/工作目录传递与脱敏检查后 **26/26 通过**。 | `.agent-kernel-cli/acceptance/check-windows-sandbox.tests.ps1` |
| One real Codex call<br/>一次真实 Codex 调用 | On 2026-09-12 the single attempt returned `orchestrator_helper_launch_canceled: ShellExecuteExW failed to launch setup helper: 1223`. Nothing was read, no summary was produced. The CLI stored `failed` / `codex_incomplete`.<br/>2026-09-12 的唯一一次尝试返回 `orchestrator_helper_launch_canceled: ShellExecuteExW failed to launch setup helper: 1223`。没有读到文件，没有产出汇总。CLI 记为 `failed` / `codex_incomplete`。 | Previous README; run log kept local, not in Git<br/>上一版 README；运行日志留在本地，未入库 |
| Model-task budget<br/>模型任务额度 | 2 authorised, **0 used** at last record. The account check reported the weekly Codex quota at 100% used.<br/>授权 2 次，**已用 0 次**。账号检查显示 Codex 周额度使用率 100%。 | Previous README<br/>上一版 README |
| Strict Job independence<br/>Job 严格独立性 | **Not proven.** `jobOwnership=unknown`, `insideAnyJob=true`; the ordinary-terminal diagnostic mode allows the check to run without claiming independence.<br/>**未证明。** `jobOwnership=unknown`、`insideAnyJob=true`；普通终端诊断模式允许检查跑起来，但不声称独立性。 | `check-windows-sandbox.ps1` |
| Root cause of 1223<br/>1223 的根因 | **Unknown.** It was localised to the official sandbox setup/compatibility stage; neither "user cancelled" nor "CLI Job conditions" can be ruled out.<br/>**未知。** 已定位到官方沙箱准备/兼容阶段；既不能断定"用户取消"，也不能排除新 CLI 的 Job 条件参与其中。 | Previous README<br/>上一版 README |

Three anti-overclaim rules this project follows, and one it does not yet satisfy:

这个项目遵守三条"不夸大"的规则，还有一条尚未满足：

- An exit code of `0` from the underlying program is not treated as success when the record contains a structured error.<br/>底层程序退出码为 `0` 时，只要记录里有结构化错误，就不当作成功。
- A transcript of a successful ordinary-terminal check is not promoted to "strictly independent environment".<br/>一次普通终端检查成功，不会被升格为"严格独立环境"。
- A failed receipt is never rewritten; later diagnoses are stored beside it.<br/>失败回执永不改写；后续诊断另存旁边。
- Not yet satisfied: proving that a helper which detached from the process tree has exited.<br/>尚未满足：证明脱离进程树的助手进程已经退出。

## Documentation · 文档

| Doc · 文档 | Read it when · 什么场景读它 |
|---|---|
| [`LICENSE`](LICENSE) | You need the MIT terms. `duration-policy.ts` is adapted from Orca kernel code, so the original copyright notice is retained here.<br/>需要 MIT 条款时。`duration-policy.ts` 改编自 Orca kernel 代码，因此原始版权声明保留在此。 |
| [`src/windows/job.cs`](src/windows/job.cs) | You are changing how the Job object is created, watched or terminated.<br/>要改 Job 对象的创建、监视或终止方式时。 |
| [`.agent-kernel-cli/acceptance/check-windows-sandbox.ps1`](.agent-kernel-cli/acceptance/check-windows-sandbox.ps1) | You are auditing what the Codex read-only check actually does, including its `-OrdinaryTerminalDiagnostic` mode.<br/>要审计 Codex 只读检查到底做了什么，包括它的 `-OrdinaryTerminalDiagnostic` 模式。 |
| [`.agent-kernel-cli/acceptance/check-windows-sandbox.tests.ps1`](.agent-kernel-cli/acceptance/check-windows-sandbox.tests.ps1) | You are changing the admission rules and need the deterministic checks that pin them.<br/>要改准入规则，需要钉住它们的确定性检查时。 |
| [`tsconfig.json`](tsconfig.json) | You need the compiler target and module settings.<br/>需要编译目标与模块设置时。 |

The root of the repository also holds a Markdown task list recording which items are done and which remain open, including the two pending model-task authorisations.

仓库根目录还有一份 Markdown 任务清单，记录哪些事项已完成、哪些仍未完成，包括那两次待执行的模型任务授权。

## Repository layout · 仓库结构

```text
agent-kernel-cli/
├── src/
│   ├── cli.ts                  # argument parsing, four commands, JSON output
│   ├── task-lifecycle.ts       # start / stop / result, one task per store
│   ├── supervisor.ts           # detached supervisor, exit handling
│   ├── run-store.ts            # atomic JSON records, Windows rename retries
│   ├── run-types.ts            # the eight phases
│   ├── duration-policy.ts      # timeout / output-limit parsing (adapted, MIT)
│   ├── codex-command.ts        # read-only Codex invocation, binary resolution
│   ├── task-command.ts         # local-only path validation (rejects UNC/remote)
│   ├── process-environment.ts  # strips inherited authority and billing keys
│   ├── windows-process.ts      # Job launching from Node
│   └── windows/job.cs, job.ps1 # the Job object implementation
├── tests/                      # 8 files, 20 test() cases, plus fixtures/
├── scripts/copy-runtime.mjs    # copies the Job sources into dist/
├── .agent-kernel-cli/acceptance/  # sandbox check script and its tests
├── package.json                # node >=24, pnpm 10.24.0, zero runtime deps
└── LICENSE                     # MIT, Copyright (c) 2026 Lovecast Inc.
```

## Status · 状态

Version `0.1.0`, private package, MIT licensed. The program path is the mature half: `start`/`status`/`stop`/`result` with a Job-owned process tree and deterministic tests for success, failure, timeout, repeated stop, three-generation reaping, bystander survival, supervisor exit, Unicode and quoted arguments, stale or wrong-host records, and Windows atomic-rename contention.

版本 `0.1.0`，私有包，MIT 许可。成熟的是普通程序那半边：`start`/`status`/`stop`/`result`，Job 拥有的进程树，以及覆盖成功、失败、超时、重复停止、三代进程回收、旁观进程存活、监督者退出、中文与引号参数、过期或错误主机记录、Windows 原子重命名争斗的确定性测试。

The Codex path is the unfinished half, and the previous README said so: the one real call failed at sandbox setup, the strict Job independence was never proven, and the model-task budget is still 0 of 2 used.

Codex 那半边尚未完成，上一版 README 也是这么写的：唯一一次真实调用在沙箱准备阶段失败，Job 严格独立性从未被证明，模型任务额度仍是 0/2。

Known limits, stated rather than hidden:

边界写出来而不是藏起来：

- **Windows only.** `start` rejects Linux/macOS outright. SSH, UNC and WSL remote paths are not handled, and remote execution does not exist.<br/>**只支持 Windows。** `start` 直接拒绝 Linux/macOS。SSH、UNC、WSL 远程路径不接管，远程执行不存在。
- **Program mode is for trusted programs.** There is no shell and no sandbox for it, and the Windows Job is not a file, network or WMI boundary.<br/>**普通程序模式只适用于受信任程序。** 它既没有 shell 也没有沙箱，Windows Job 不是文件、网络或 WMI 边界。
- **No queue, retry or daemon.** One task per store, no automatic retry, no service installation, no multi-agent orchestration.<br/>**没有队列、重试、后台服务。** 一个 store 一个任务，无自动重试，无服务安装，无多 Agent 编排。
- **Supervisor loss keeps the lease.** The record becomes `unverifiable` and stays occupied; nothing kills by a PID read off disk.<br/>**监督者失联会保留占用。** 记录变为 `unverifiable` 并保持占用；不会依据磁盘上的 PID 去杀进程。
- **Not implemented:** safe recovery from an unverifiable owner, multi-user adversarial isolation, and power-loss durability.<br/>**尚未实现：** 失联占用的安全恢复、多用户对抗性隔离、断电耐久性。
- **Run records are sensitive.** They contain the task body and the captured output, so callers must limit what they pass in.<br/>**运行记录是敏感数据。** 其中包含任务正文与捕获输出，调用方必须限制传入内容。

The previous version of this page claimed a `37/37` test run; that number is preserved above as a record, with its source and its mismatch against the 20 declarations now visible in the tree. A reader who re-runs `pnpm test` gets the number that matters today.

上一版这一页主张了 `37/37` 的测试结果；这个数字作为记录保留在上面，同时标明了出处，以及它与当前代码树里可见的 20 个声明之间的差异。重跑 `pnpm test` 的人拿到的是今天的数字。

## License · 许可

MIT © 2026 Lovecast Inc. See [`LICENSE`](LICENSE).

MIT © 2026 Lovecast Inc.，见 [`LICENSE`](LICENSE)。
