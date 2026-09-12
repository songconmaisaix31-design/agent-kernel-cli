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

Codex 模式只复用已登录的 ChatGPT 账号，固定只读沙箱和拒绝权限升级，保留用户规则；不支持 API Key 计费或自动登录。通过 PATH 查找已有原生或官方 npm Codex，特殊安装可用 `AGENT_KERNEL_CODEX_BIN` 指向已有原生程序。不复制凭据或改变系统 PATH。参数参照 [官方非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)。**当前本机沙箱初始化阻塞，下面命令仅在人工处理后另行验收，不应重复触发。**

```powershell
node dist/cli.js start --agent codex --cwd C:\Users\DW\agent-kernel-cli-practice --prompt 'Read task-data.json. Return project and sum of units. Do not change files.' --timeout-ms 240000
```

## 验证与真实结果

`pnpm build`、`pnpm test`：**33/33 通过**。覆盖成功/失败/超时、重复停止、三代进程回收、旁观进程存活、监督者退出、中文/引号参数、过期/错误主机拒绝。初版的 PowerShell UTF-8 解码和控制输入阻塞问题已修复。

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

## 限制与后续

- 需要人工决定并完成 **Codex Windows elevated 沙箱初始化**，可能涉及系统设置，本轮不执行、不降级沙箱。Codex 自身写入用户目录沙箱缓存/日志；未批准初始化。一次旧式 sandbox 帮助探测被当前 CLI 解析为执行参数，已停止该诊断进程，无第二次模型调用。
- 执行后端仅 Windows。Linux/macOS 的 start 明确拒绝；SSH/UNC/WSL 远程路径不接管。只读检查发现现有 WSL2 Ubuntu、Docker Desktop，以及停止的 OrcaKernelLab-v014188/kali-linux；约 32 GB RAM，HypervisorPresent=true。未安装虚拟化软件或启动停止中的系统。
- 后续 Linux VM 需要已批准的 VM/发行版、Node 24+、Git、已有账号 Codex 和可用只读沙箱；先实现、验收进程组归属、停止/超时/断联/重启，再执行真实只读任务。WSL 环境检查不是 VM 验收。
- Windows 停止是对本次 Job 内进程的强制终止，依据 [系统 Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。程序模式限受信任测试程序，Job 不是文件/网络沙箱，也不能证明外部服务/WMI/远程工作已停止。
- 监督者失联显示 unverifiable，保留占用，不依据磁盘 PID 杀进程或自动解锁。安全恢复、多用户对抗性隔离、断电耐久性未实现/验收。运行记录含任务正文和输出，调用方应限制敏感输入。
- 源码通过 `origin/main` 同步至上述私有仓库；运行记录、练习仓库和旧成果备份保留本地。恢复旧成果时先把 bundle 克隆到新目录，再按清单恢复工作树和文件；不要用旧 .git 指针覆盖新仓库，也不恢复旧 Run 派发权限。
