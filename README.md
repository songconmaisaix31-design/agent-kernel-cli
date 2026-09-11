# agent-kernel-cli

本地单任务 CLI 原型；用稳定 Orca/Codex 开发，运行时不依赖 Orca。不承担真实产品开发。本轮不建远端、不发布。只维护本说明和 TODO.md。

旧成果：主仓库 C:/Users/DW/AppData/Local/OrcaKernelLab/code/orca-kernel，分支 kernel/v01-managed-dispatch，HEAD 01bd406abb787a6b2fd8064e66bcefb75971b8ff（Orca 1.4.188）；早期规则仓库 C:/Users/DW/orca/Multi-agent-kernel，HEAD 68e84c6f22b50676ab8a964af0a7b8dbb1223fd5。稳定开发 Orca 实测 1.4.199，保持运行。

备份 D:/AgentKernelBackups/20260912-cli-reset：essential-0.bundle / essential-1.bundle 均已 verify、独立 clone、fsck、HEAD 检出；essential-recovery.json 记录 19 个工作树的提交和未提交文件副本校验。source-and-evidence.zip 是完整源码及旧验收材料归档，最终检查待完成。排除可重装 node_modules 和 reparse targets，原始文件保留。没有删除/reset/清理旧文件；旧 2 个 ready 任务不再派发，15 retained / 3 released 历史资源不改写。旧资源的进程状态仍 unverifiable；现场除本次开发终端外未发现旧 Kernel Agent，不能由此认定所有历史进程已退出。其他产品不受本轮控制。

源码来源：src/duration-policy.ts 只改编旧仓库上述 SHA 的 src/main/runtime/orchestration/kernel-run-limits.ts 中 parseKernelLimits 的有限正整数和未知字段拒绝规则；tests/duration-policy.test.mjs 改编同目录 kernel-run-limits.test.ts 的无效数值和对象反例。保留原 MIT / Copyright (c) 2026 Lovecast Inc. 于 LICENSE。未复制协调器、数据库、Electron、规则图或旧测试框架。

运行、真实验收和限制将在实际测试后补齐。
