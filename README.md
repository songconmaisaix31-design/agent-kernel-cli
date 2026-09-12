# agent-kernel-cli

本地单任务 CLI 原型；用稳定 Orca/Codex 开发，运行时不依赖 Orca。不承担真实产品开发。按用户后续授权建立 [GitHub 私有仓库](https://github.com/songconmaisaix31-design/agent-kernel-cli)，用于源码同步，不发布 Release。只维护本说明和 TODO.md。

旧成果：主仓库 C:/Users/DW/AppData/Local/OrcaKernelLab/code/orca-kernel，分支 kernel/v01-managed-dispatch，HEAD 01bd406abb787a6b2fd8064e66bcefb75971b8ff（Orca 1.4.188）；早期规则仓库 C:/Users/DW/orca/Multi-agent-kernel，HEAD 68e84c6f22b50676ab8a964af0a7b8dbb1223fd5。稳定开发 Orca 实测 1.4.199，保持运行。

备份 D:/AgentKernelBackups/20260912-cli-reset：两套仓库的 essential-0.bundle / essential-1.bundle 及最终 repo-0.bundle / repo-1.bundle 均已 verify、独立 clone、fsck；19 个工作树的 HEAD 均可恢复。source-and-evidence.zip 的 355,093 个文件通过 CRC 校验；补充旧实验目录 legacy-experiments.zip 的 2,753 个文件也通过 CRC。18 个未提交文件已取出恢复，与初始副本和原文件逐字节相同；旧仓库 HEAD/status 未变。以 recovery-summary.json、audit.json、essential-recovery.json 为恢复清单；前期中间输出不作为完整备份。排除可重装 node_modules 和 reparse targets，原始文件保留。

没有删除/reset/清理旧文件；旧 2 个 ready 任务不再派发，15 retained / 3 released 历史资源不改写。旧资源的进程状态仍 unverifiable；现场除本次开发终端外未发现旧 Kernel Agent，不能由此认定所有历史进程已退出。其他产品不受本轮控制。

源码来源：src/duration-policy.ts 只改编旧仓库上述 SHA 的 src/main/runtime/orchestration/kernel-run-limits.ts 中 parseKernelLimits 的有限正整数和未知字段拒绝规则；tests/duration-policy.test.mjs 改编同目录 kernel-run-limits.test.ts 的无效数值和对象反例。保留原 MIT / Copyright (c) 2026 Lovecast Inc. 于 LICENSE。未复制协调器、数据库、Electron、规则图或旧测试框架。

## 运行

本机 Windows 11 家庭中文版 10.0.26200，Node 24.16.0、pnpm 10.24.0、Codex 0.154.0。运行无 npm 依赖；构建使用 TypeScript。普通程序模式无需管理员权限，不修改执行策略。

```powershell
cd C:\Users\DW\agent-kernel-cli
pnpm install --frozen-lockfile
pnpm build
$task = node dist/cli.js start --agent program --cwd . -- node tests/fixtures/program.mjs success | ConvertFrom-Json
node dist/cli.js status $task.id
node dist/cli.js result $task.id
$task = node dist/cli.js start --agent program --cwd . --timeout-ms 30000 -- node tests/fixtures/program.mjs tree | ConvertFrom-Json
node dist/cli.js stop $task.id
```

默认记录在 `~/.agent-kernel-cli`，可用 `--store <目录>` 指定。响应均为 JSON；start 返回 starting 不代表已执行，需看 running 或终态。一个 store 同时一个任务，无队列、自动重试或后台服务安装。支持普通文件夹。result 对失败/超时/未完成/无法核实返回非零。

Codex 模式只复用已登录的 ChatGPT 账号，固定只读沙箱和拒绝权限升级，保留用户规则；不支持 API Key 计费或自动登录。通过 PATH 查找已有原生或官方 npm Codex，特殊安装可用 `AGENT_KERNEL_CODEX_BIN` 指向已有原生程序。不复制凭据或改变系统 PATH。参数参照 [官方非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)。**当前真实只读验收受阻；先完成下文无模型检查及证据审核，再按授权顺序执行模型验收，不应重复触发。普通终端诊断不证明外层 Job 独立。**

```powershell
node dist/cli.js start --agent codex --cwd C:\Users\DW\agent-kernel-cli-practice --prompt 'Read task-data.json. Return project and sum of units. Do not change files.' --timeout-ms 240000
```

## 验证与真实结果

`pnpm build`、`pnpm test`：最新 **37/37 通过**。覆盖成功/失败/超时、重复停止、三代进程回收、旁观进程存活、监督者退出、中文/引号参数、过期/错误主机拒绝，以及 Windows 原子状态更新的短暂重命名失败。初版的 PowerShell UTF-8 解码和控制输入阻塞问题已修复。

另在剔除 Orca PATH 和会话环境变量的独立子进程中完成普通任务，succeeded / exited；回执在 `.agent-kernel-cli/acceptance/independent-runtime.json`。没有为这项核对关闭稳定 Orca。

2026-09-12 02:54:34—02:57:24（北京时间）执行了**唯一一次真实 Codex 调用**。练习仓库 `C:/Users/DW/agent-kernel-cli-practice`，main / `065d4be`。任务 `992427fc-939d-438a-a720-79da76ab03f3` 的实际最终消息：

```text
exec_command failed: Failed to create unified exec process:
orchestrator_helper_launch_canceled: ShellExecuteExW failed to launch setup helper: 1223
```

**FAILED：没有读到文件，没有真实成功的汇总结果。** Codex exit 0，但任务报告错误，CLI 保存 failed / codex_incomplete，Job 进程已确认退出。WebSocket 的有限重连/HTTPS 回退、可选 Vercel MCP 鉴权错误均留日志；未重新提交模型任务。随后修正了结果解析：重连警告不能单独认定失败，最终 `{error: ...}` 仍是失败；同一真实日志的离线复核确认 1223，历史失败记录未改写。

```powershell
node dist/cli.js result 992427fc-939d-438a-a720-79da76ab03f3 --store .agent-kernel-cli/real
```

简明回执 `.agent-kernel-cli/acceptance/real-call.json`；完整日志在 `.agent-kernel-cli/real/runs/<任务 ID>/`，留本地不入 Git。练习文件前后 SHA-256 相同，Git 干净。未购买额度。

## 只读诊断续验（2026-09-12）

**当前结论：普通终端无模型沙箱检查通过；直接 Codex 和新 CLI 真实验收均未执行，原两次授权累计仍为 0/2。** 原始 `sandbox-check-20260912T022746843Z/` 保持 `EXITED_REVIEW_REQUIRED`，另存审查记录 `sandbox-review-20260912T022746843Z.json`。已审查通过的无模型检查无需重跑。

本次记录包含预定 PowerShell 命令的 START、stdout `sandbox-ready`、实际 Node/Codex 入口 exit 0、完整捕获且为空的 stderr，以及同一次初始化后的 `setup provisioning binary completed`、`processed 0 write roots ... errors=[]`、只读 ACL 完成和命令运行器启动。初始化确实执行并完成，不能把前面的 setup-required 行当作最终失败；未见本次权限降级。保留末尾 `hide users ... C:\Users\Default ... SetFileAttributesW ... 5` 的目录属性警告，不将它改写为 ACL 或命令执行失败。外层 Job 归属仍 unknown，严格独立性未证明，脱离进程树的助手退出仍不可核实；不推导历史 1223 的根因或全面沙箱安全性。

当前测试目录 `C:\Users\DW\.codex` 仍是旧 ChatGPT 账号，与当前 Orca 账号不同。官方 `account/read`、`account/rateLimits/read` 在未创建线程或提交模型任务的情况下确认：`ordinaryUsageAllowed=false`、Codex 周额度使用率 100%。账号检查保存在本地 `account-preflight-20260912T023812446Z.json`，未包含凭据。没有复制凭据、购买额度或使用额度重置；需要本人在测试目录登录可用账号，再复查授权与余额后继续 A→B。`login status` 本身只显示已有 ChatGPT 登录，不能单独证明还有额度。

本人登录入口（仅在子 PowerShell 中设置测试 CODEX_HOME，按提示使用有额度的 ChatGPT 账号）：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -Command { $env:CODEX_HOME='C:\Users\DW\.codex'; & 'C:\Program Files\nodejs\node.exe' 'C:\Users\DW\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js' login --device-auth }
```

本机 `help exec` 已确认 `exec --sandbox read-only`，现有产品使用 `--ask-for-approval never exec --sandbox read-only --json --ephemeral --color never -`；不得照搬 `sandbox --permission-profile`。A/B 均须明确传入测试 CODEX_HOME、同一执行器和练习目录，并核对 B 的子进程记录与实际环境。随机答案不进入提示，A 失败不执行 B，账号切换不重置原两次授权。

本轮首次产品测试为 31/33：两处 `supervisor.log` 均记录状态文件原子重命名 `EPERM` 导致监督进程退出，原目录 `tests/run-EhRf7S/`、`tests/run-MBujnv/` 和占用保留。已窄修 Windows `EPERM/EACCES/EBUSY` 重命名最多额外尝试 5 次，每次等待 50ms；持续错误原样抛出，原文件不删除，POSIX 和其他错误不重试，不改 Job/停止机制。确定性反例修复前 2/4、修复后 4/4；最终构建和全部 37 项测试通过，输出另存 `product-tests-after-state-rename.log`。这些均不包含真实模型任务。

以下为保留的历史诊断和执行边界：

从 `1f29f957723f5515049fecd5087dc3f784cae438` 继续；相对指定的 `7443c1b` 仅有 README/TODO 更新。**本轮新增真实模型任务 0/2；直接 Codex 与新 CLI 均未开始真实验收。** 原失败回执不改写，新诊断单独记录于 `.agent-kernel-cli/acceptance/20260912-sandbox-diagnosis.json`。

| 核对项 | 日常 Codex 会话 | 新 CLI 的 Codex 调用 |
| --- | --- | --- |
| 执行器 | npm `@openai/codex`，0.154.0 | 同一 npm 包及原生 `codex.exe`，由 Node 入口启动 |
| 配置目录 | `C:/Users/DW/AppData/Roaming/orca/codex-runtime-home/home` | 子进程未设置 CODEX_HOME，读取 `C:/Users/DW/.codex/config.toml` |
| 权限 | 当前会话记录为 `danger-full-access`，启动参数含 `--yolo` | `--ask-for-approval never exec --sandbox read-only --json --ephemeral --color never -` |
| 工作目录 | 旧 Orca Kernel 仓库 | `C:/Users/DW/agent-kernel-cli-practice`，没有项目级 Codex 配置 |
| 进程启动 | Orca 终端中的交互会话 | 普通用户、非管理员，Windows Job 内启动，无 breakaway |

两份配置均选择 `gpt-6-astra` / `xhigh` / Windows `elevated`，但文件不完全相同；日常可用不能证明只读沙箱可用。旧 `.codex/.sandbox/sandbox.2026-09-11.log` 记录 02:55:02 刷新完成、errors=[]，随后 02:55:03 报 `sandbox users missing or incompatible with marker version`，之后出现助手启动错误 1223。当前两个专用账户均存在且启用，两处标记均为 version 5，且共用账户。因此只能定位到官方沙箱准备/兼容检查阶段；**不能由 1223 断定用户取消，亦不能排除新 CLI 的 Job/非交互启动条件参与失败**。官方 `doctor --json` 45 秒超时，未得到诊断报告，没有重试。

本次从实际 HEAD `f69b172852b747594cc63385ebbd24296bfd8a34`、干净工作区继续，保留已有提交。用户已在手动打开的普通 PowerShell 中运行原脚本，报告两项查询成功、非管理员、未识别开发祖先，祖先链为 `explorer.exe → pwsh.exe → pwsh.exe`，但 `insideAnyJob=true`，仍被原第 57 行拒绝。**真正的前置阻断是 `$eligible` 中的 `-not $insideJob`；启动 Codex 子进程后还有相同限制。** [IsProcessInJob 的官方定义](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob)说明空 Job 句柄只查询任意 Job，不能识别创建者或用途。先前将未知 Job 一律拒绝过于严格；不能猜测其来源，也不能仅由祖先中没有 Orca 证明完全独立。

已窄修 `.agent-kernel-cli/acceptance/check-windows-sandbox.ps1`，增加显式 `-OrdinaryTerminalDiagnostic`，将诊断准入与严格独立性分开。普通用户、查询成功、未识别开发祖先时，允许用户在手动终端执行无模型检查；未知外层 Job 保留 `insideAnyJob=true`、`jobOwnership=unknown`，严格独立性仍未证明，并显示提示。该参数只是用户对手动启动的声明，不替代现场查询。默认严格模式仍拒绝任意 Job；两种模式均拒绝已识别开发祖先、管理员或查询失败。失败查询值记为 null/unknown，预检保存 `preflight-<时间>.json` 后停止。子进程沿用同样判断，不移除外层 Job。

专用 `check-windows-sandbox.tests.ps1` 通过 **19 项确定性测试**，只加载判断函数与执行前的阻断条件，覆盖未知 Job、开发祖先、查询失败、管理员及子进程继承；不启动 Codex。脚本和专用测试纳入 Git；旧脚本副本 `check-windows-sandbox.before-ordinary-terminal.ps1`、原失败回执和历史诊断保留本地，新结果为 `20260912-ordinary-terminal-script-fix.json`。本轮未重跑产品构建或原 33 项测试，未执行实际沙箱命令、系统变更或模型调用；模型额度仍为 **0/2**。

随后用户手动运行普通终端检查，原记录保留在 `sandbox-check-20260912T015158737Z/`。`stderr.log` 的实际错误为 `error: the following required arguments were not provided: --permission-profile <NAME>`；stdout 和沙箱日志增量均为空。`result.json` 记录 Node 入口 PID 61264、exit 2、未超时、完整捕获输出、脚本异常为空。官方 npm 入口将参数逐项传给原生 Codex，并转交其退出码；此次失败定位于 Codex 参数解析，不能据此判断旧 1223、账户权限或沙箱初始化。外层 Job 仍为 unknown，严格独立性仍未证明。

已按同一固定二进制的 `help sandbox` 修正内部参数：显式传入 `--permission-profile :read-only`，保留 `windows.sandbox="elevated"`，移除旧 `sandbox_mode` 覆盖；[官方权限文档](https://learn.chatgpt.com/docs/permissions)将 `:read-only` 定义为内置只读配置，无需新增用户配置。原 PowerShell 调用命令的语法有效，缺项位于脚本生成的 Codex 参数。失败时现在显示最多 8 行脱敏错误摘要及记录目录，并区分 stderr 为空和未完整捕获。

本次 `pwsh -NoProfile -File .agent-kernel-cli/acceptance/check-windows-sandbox.tests.ps1` **26/26 通过**：保留原 19 项准入检查，增加真实 Node 测试进程的逐项参数/工作目录传递（空格、中文、引号、末尾路径分隔符），以及摘要脱敏、长度限制和捕获状态检查。仅执行帮助读取和本地确定性测试，未启动实际沙箱命令、模型任务或 doctor，未改系统、持久配置和产品 Job/停止代码；未重跑产品构建和 33 项产品测试。参数传递检查不等于沙箱实际通过，旧 1223 的原因仍未确定。

以下是已经完成并审查通过的无模型检查命令，保留供追溯，本轮不要重跑：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File 'C:\Users\DW\agent-kernel-cli\.agent-kernel-cli\acceptance\check-windows-sandbox.ps1' -OrdinaryTerminalDiagnostic
```

脚本保存并恢复临时 CODEX_HOME 和工作目录，固定已核对的 Codex 二进制，先进入练习目录，再指定 `--permission-profile :read-only`、`windows.sandbox=elevated`，只执行 `Write-Output 'sandbox-ready'`。不读写练习文件、不调用模型、不改持久化配置，不使用 ExecutionPolicy Bypass、自动提权或隐藏窗口。输出、真实退出码和本次时间窗口的沙箱日志增量保存到 `sandbox-check-<时间>/`；并发日志需核对归属。120 秒不返回就记录超时，只请求终止本次创建进程的树；脱离进程树的助手状态记为无法核实，不按进程名批量结束。脚本不会把输出标记自动升级为验收通过，仍须核对实际配置、日志及所有通过条件；普通终端兼容性检查成功也不能冒称严格独立环境验收通过。

官方 elevated 初始化可能创建/修复专用本地账户、文件 ACL、防火墙规则和登录权限，见 [官方 Windows 沙箱说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)。这些是系统状态，且本机与 Orca 管理目录共用沙箱账户，不能承诺对日常沙箱零影响；不需要长期以管理员运行 Kernel，不重装/升级 Codex，不手工改全盘 ACL。检查应输出 `sandbox-ready`、退出码 0，沙箱日志无 setup-required/助手错误且保持 elevated；这仅证明无模型检查通过。若需改稳定 Orca 或仍失败，保留阻塞，不继续折腾 Windows。

如果需要初始化，官方程序为同一 npm 包的 `vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe`；脚本会在运行前显示完整路径。只由用户本人决定是否批准 UAC，拒绝降级或完全访问选项。

无模型前置检查已经通过；账号具备可用额度后，沿用同一执行器、配置目录、权限与练习目录：先写入不传给提示/stdin/历史的随机文字，直接 Codex 只读验收；成功后轮换文字再经新 CLI 验收。每次均核对实际读取事件、正确输出、退出结果、文件前后内容；直接失败则停止，原授权累计最多两次真实任务且不自动重试。两种真实验收分别记结果，不能互相替代。

## 限制与后续

- 官方沙箱检查与该次必要初始化已由用户手动执行并审查通过。当前人工动作是测试 CODEX_HOME 登录可用账号；本轮 Agent 未执行系统变更。首轮失败、旧帮助探测和本次目录属性警告仍保留。
- 执行后端仅 Windows。Linux/macOS 的 start 明确拒绝；SSH/UNC/WSL 远程路径不接管。只读检查发现现有 WSL2 Ubuntu、Docker Desktop，以及停止的 OrcaKernelLab-v014188/kali-linux；约 32 GB RAM，HypervisorPresent=true。未安装虚拟化软件或启动停止中的系统。
- 后续 Linux VM 需要已批准的 VM/发行版、Node 24+、Git、已有账号 Codex 和可用只读沙箱；先实现、验收进程组归属、停止/超时/断联/重启，再执行真实只读任务。WSL 环境检查不是 VM 验收。
- Windows 停止是对本次 Job 内进程的强制终止，依据 [系统 Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。程序模式限受信任测试程序，Job 不是文件/网络沙箱，也不能证明外部服务/WMI/远程工作已停止。
- 监督者失联显示 unverifiable，保留占用，不依据磁盘 PID 杀进程或自动解锁。安全恢复、多用户对抗性隔离、断电耐久性未实现/验收。运行记录含任务正文和输出，调用方应限制敏感输入。
- 源码通过 `origin/main` 同步至上述私有仓库；运行记录、练习仓库和旧成果备份保留本地。恢复旧成果时先把 bundle 克隆到新目录，再按清单恢复工作树和文件；不要用旧 .git 指针覆盖新仓库，也不恢复旧 Run 派发权限。
