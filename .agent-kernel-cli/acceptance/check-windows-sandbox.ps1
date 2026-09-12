#requires -Version 7.0
[CmdletBinding()]
param([switch]$PreflightOnly, [switch]$OrdinaryTerminalDiagnostic)

$ErrorActionPreference = 'Stop'
$testHome = 'C:\Users\DW\.codex'
$practice = 'C:\Users\DW\agent-kernel-cli-practice'
$node = 'C:\Program Files\nodejs\node.exe'
$entry = 'C:\Users\DW\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js'
$vendor = 'C:\Users\DW\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc'
$binary = Join-Path $vendor 'bin\codex.exe'
$setup = Join-Path $vendor 'codex-resources\codex-windows-sandbox-setup.exe'
$expectedBinaryHash = 'BE96B992178B1E467C225800DA0D65F2C86D5EBA1EF0B14632F65DB381CBDFDE'
$shell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$timeoutSeconds = 120

function Get-SandboxCheckDecision([System.Collections.IDictionary]$Context, [switch]$OrdinaryTerminalDiagnostic) {
    $reasons = @()
    if (-not $Context.jobQuerySucceeded -or $null -eq $Context.insideAnyJob) { $reasons += 'job_query_failed' }
    if (-not $Context.ancestorQuerySucceeded -or $null -eq $Context.developmentAncestor) { $reasons += 'ancestor_query_failed' }
    if (-not $Context.privilegeQuerySucceeded -or $null -eq $Context.elevated) { $reasons += 'privilege_query_failed' }
    if ($Context.elevated -eq $true) { $reasons += 'administrator_process' }
    if ($Context.developmentAncestor -eq $true) { $reasons += 'known_development_ancestor' }
    $ordinaryEligible = $reasons.Count -eq 0
    $strictEligible = $ordinaryEligible -and $Context.insideAnyJob -eq $false
    if (-not $OrdinaryTerminalDiagnostic -and $Context.insideAnyJob -eq $true) {
        $reasons += 'unknown_outer_job_requires_explicit_ordinary_terminal_mode'
    }
    [ordered]@{
        mode = if ($OrdinaryTerminalDiagnostic) { 'ordinary_terminal_diagnostic' } else { 'strict_independent_check' }
        manualLaunchAcknowledged = [bool]$OrdinaryTerminalDiagnostic
        launchProvenance = 'Manual launch is a caller declaration, not proved by the ancestor list.'
        jobOwnership = if ($Context.jobQuerySucceeded -and $Context.insideAnyJob -eq $false) { 'none' } else { 'unknown' }
        eligibleForIndependentCheck = $strictEligible
        eligibleForOrdinaryTerminalDiagnostic = $ordinaryEligible
        allowedToRun = $ordinaryEligible -and ($strictEligible -or $OrdinaryTerminalDiagnostic)
        stopReasons = $reasons
    }
}

$insideJob = $null
$jobQueryOk = $false
$jobQueryError = $null
try {
    if (-not ('SandboxCheckContext' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SandboxCheckContext {
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
}
'@
    }
    $jobValue = $false
    $jobQueryOk = [SandboxCheckContext]::IsProcessInJob([SandboxCheckContext]::GetCurrentProcess(), [IntPtr]::Zero, [ref]$jobValue)
    if ($jobQueryOk) { $insideJob = $jobValue }
    else { $jobQueryError = 'Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
} catch { $jobQueryError = 'Job API query unavailable.' }
$privilegeQueryOk = $false
$elevated = $null
try {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $privilegeQueryOk = $true
} catch {
    $elevated = $null
}
$ancestors = @()
$ancestorQueryOk = $true
try {
    $cursor = $PID
    for ($i = 0; $i -lt 12 -and $cursor -gt 0; $i++) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor"
        if ($null -eq $p) { break }
        $ancestors += [ordered]@{ pid = $p.ProcessId; parentPid = $p.ParentProcessId; name = $p.Name }
        $cursor = [int]$p.ParentProcessId
    }
} catch { $ancestorQueryOk = $false }
$developmentAncestor = if ($ancestorQueryOk) { @($ancestors | Where-Object { $_.name -match '^(Orca|codex|codex-code-mode-host|node)\.exe$' }).Count -gt 0 } else { $null }
$context = [ordered]@{
    pid = $PID; jobQuerySucceeded = $jobQueryOk; insideAnyJob = $insideJob
    jobQueryError = $jobQueryError; privilegeQuerySucceeded = $privilegeQueryOk; elevated = $elevated
    ancestorQuerySucceeded = $ancestorQueryOk; developmentAncestor = $developmentAncestor
    ancestors = $ancestors; modelTasksSubmitted = 0
}
$decision = Get-SandboxCheckDecision $context -OrdinaryTerminalDiagnostic:$OrdinaryTerminalDiagnostic
foreach ($key in $decision.Keys) { $context[$key] = $decision[$key] }
$preflightPath = Join-Path $PSScriptRoot ('preflight-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')
$context | ConvertTo-Json -Depth 5 | Out-File -LiteralPath $preflightPath -Encoding utf8 -NoClobber
if ($PreflightOnly) {
    $context | ConvertTo-Json -Depth 5
    return
}
if (-not $decision.allowedToRun) {
    $context | ConvertTo-Json -Depth 5
    throw "Preflight stopped: $($decision.stopReasons -join ', '). No sandbox command was started. Recorded: $preflightPath"
}
if ($OrdinaryTerminalDiagnostic) {
    Write-Warning 'Ordinary terminal diagnostic only. Manual launch is caller-declared; this mode is not strict independent acceptance.'
    if ($insideJob) { Write-Warning 'Outer Job ownership is unknown. It remains in effect; strict independence is not proved.' }
}
foreach ($path in @($testHome, $practice, $node, $entry, $binary, $shell)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required existing path is missing: $path" }
}
if ((Get-FileHash -LiteralPath $binary).Hash -ne $expectedBinaryHash) {
    throw 'Codex binary differs from the inspected 0.154.0 installation. Stop and inspect the new evidence; do not automatically update or retry.'
}

function Protect-CheckText([string]$Text) {
    (($Text -split '\r?\n') | ForEach-Object {
        if ($_ -match '(?i)sandbox-secrets|authorization|bearer\s|(?:access|refresh|id)[_-]token|api[_-]?key\s*[:=]|password\s*[:=]|\bsk-[A-Za-z0-9_-]{16,}') {
            '[sensitive diagnostic line omitted]'
        } else { $_ }
    }) -join "`n"
}

$recordDirectory = Join-Path $PSScriptRoot ('sandbox-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Path $recordDirectory -ErrorAction Stop | Out-Null
$hadHome = Test-Path Env:CODEX_HOME
$previousHome = $env:CODEX_HOME
$previousLocation = Get-Location
$previousProcessDirectory = [Environment]::CurrentDirectory
$logDirectory = Join-Path $testHome '.sandbox'
$config = Join-Path $testHome 'config.toml'
$configBefore = (Get-FileHash -LiteralPath $config).Hash
$logOffsets = @{}
Get-ChildItem -LiteralPath $logDirectory -Filter 'sandbox*.log' -File -ErrorAction SilentlyContinue | ForEach-Object { $logOffsets[$_.FullName] = $_.Length }
$arguments = @($entry, 'sandbox', '-c', 'sandbox_mode="read-only"', '-c', 'windows.sandbox="elevated"', '-C', $practice,
    '--', $shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "Write-Output 'sandbox-ready'")
$record = [ordered]@{
    startedAt = [DateTime]::UtcNow.ToString('o'); status = 'NOT_STARTED'; context = $context
    preflightReceipt = $preflightPath; mode = $decision.mode; strictIndependenceProven = $false
    executable = $node; arguments = $arguments; cwd = $practice; codexHome = $testHome
    binarySha256 = $expectedBinaryHash; expectedConfiguration = @{ sandbox_mode = 'read-only'; 'windows.sandbox' = 'elevated' }
    timeoutSeconds = $timeoutSeconds; exitCode = $null; timedOut = $false; error = $null
    modelTasksSubmitted = 0; existingModelBudgetModified = $false
    logCorrelation = 'New bytes in the check time window; concurrent sessions may also write these logs. Review attribution before acceptance.'
}
$process = $null
$stdoutTask = $null
$stderrTask = $null
$stdout = ''
$stderr = ''
try {
    $env:CODEX_HOME = $testHome
    Set-Location -LiteralPath $practice
    [Environment]::CurrentDirectory = $practice
    Write-Host "Official check only; no model task. Output: $recordDirectory"
    Write-Host "If initialization is required, Codex may launch: $setup"
    Write-Host 'Only you may approve its UAC prompt. Setup can change dedicated users, ACLs, firewall and logon rights shared with other Codex environments. Do not accept a weaker sandbox.'
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $node
    $startInfo.WorkingDirectory = $practice
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($argument in $arguments) { $startInfo.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Official Codex entrypoint did not start.' }
    $record.pid = $process.Id
    $record.processStartedAt = $process.StartTime.ToUniversalTime().ToString('o')
    $entryInJob = $false
    $entryJobKnown = [SandboxCheckContext]::IsProcessInJob($process.Handle, [IntPtr]::Zero, [ref]$entryInJob)
    $record.entryJobQuerySucceeded = $entryJobKnown
    $record.entryInAnyJob = if ($entryJobKnown) { $entryInJob } else { $null }
    $record.entryJobQueryError = if ($entryJobKnown) { $null } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
    $entryContext = @{}
    foreach ($key in $context.Keys) { $entryContext[$key] = $context[$key] }
    $entryContext.jobQuerySucceeded = $entryJobKnown
    $entryContext.insideAnyJob = $record.entryInAnyJob
    $entryDecision = Get-SandboxCheckDecision $entryContext -OrdinaryTerminalDiagnostic:$OrdinaryTerminalDiagnostic
    $record.entryDecision = $entryDecision
    $record.strictIndependenceProven = $decision.eligibleForIndependentCheck -and $entryDecision.eligibleForIndependentCheck
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $entryDecision.allowedToRun) { throw "Entrypoint check stopped: $($entryDecision.stopReasons -join ', ')." }
    if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
        $record.timedOut = $true
        $record.status = 'TIMEOUT'
        $record.visibleDirectChildren = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Select-Object ProcessId, ParentProcessId, Name, CreationDate)
    } else {
        $record.exitCode = $process.ExitCode
        $record.status = if ($process.ExitCode -eq 0) { 'EXITED_REVIEW_REQUIRED' } else { 'FAILED' }
    }
} catch {
    $record.error = Protect-CheckText $_.Exception.Message
    if (-not $record.timedOut) { $record.status = 'CHECK_ERROR' }
} finally {
    # Restore caller state before log collection, including when collection itself fails.
    try {
        if ($hadHome) { $env:CODEX_HOME = $previousHome } else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    } finally {
        try { Set-Location -LiteralPath $previousLocation.Path }
        finally { [Environment]::CurrentDirectory = $previousProcessDirectory }
    }
    $record.environmentAndCwdRestored = ((Test-Path Env:CODEX_HOME) -eq $hadHome) -and ($env:CODEX_HOME -eq $previousHome) -and ((Get-Location).Path -eq $previousLocation.Path) -and ([Environment]::CurrentDirectory -eq $previousProcessDirectory)
    if ($null -ne $process -and $record.Contains('pid')) {
        if (-not $process.HasExited) {
            try {
                $process.Kill($true)
                $record.terminationRequestedForOwnedTree = $true
                $record.ownedRootExited = $process.WaitForExit(5000)
            } catch { $record.terminationError = Protect-CheckText $_.Exception.Message }
        } else { $record.ownedRootExited = $true }
        if ($process.HasExited) { $record.exitCode = $process.ExitCode }
        $record.detachedHelperExit = 'unverifiable; no process-name termination was used'
    }
    try {
        $record.stdoutCaptureComplete = $null -ne $stdoutTask -and $stdoutTask.Wait(2000)
        if ($record.stdoutCaptureComplete) { $stdout = Protect-CheckText $stdoutTask.Result }
        $record.stderrCaptureComplete = $null -ne $stderrTask -and $stderrTask.Wait(2000)
        if ($record.stderrCaptureComplete) { $stderr = Protect-CheckText $stderrTask.Result }
    } catch { $record.outputCaptureError = Protect-CheckText $_.Exception.Message }
    $stdout | Set-Content -LiteralPath (Join-Path $recordDirectory 'stdout.log') -Encoding utf8
    $stderr | Set-Content -LiteralPath (Join-Path $recordDirectory 'stderr.log') -Encoding utf8
    $delta = [Text.StringBuilder]::new()
    Get-ChildItem -LiteralPath $logDirectory -Filter 'sandbox*.log' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $offset = if ($logOffsets.ContainsKey($_.FullName)) { [long]$logOffsets[$_.FullName] } else { 0L }
        if ($_.Length -lt $offset) { $offset = 0L }
        if ($_.Length -le $offset) { return }
        try {
            $stream = [IO.File]::Open($_.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            [void]$stream.Seek($offset, [IO.SeekOrigin]::Begin)
            $reader = [IO.StreamReader]::new($stream)
            try { $slice = Protect-CheckText $reader.ReadToEnd() } finally { $reader.Dispose() }
            [void]$delta.AppendLine("SOURCE: $($_.Name); FROM BYTE: $offset")
            [void]$delta.AppendLine($slice)
        } catch { [void]$delta.AppendLine('LOG READ FAILED: ' + (Protect-CheckText $_.Exception.Message)) }
    }
    $delta.ToString() | Set-Content -LiteralPath (Join-Path $recordDirectory 'sandbox-log-delta.log') -Encoding utf8
    $record.outputContainsReady = $stdout -match '(?m)^sandbox-ready\s*$'
    $record.logHasKnownFailure = ($stderr + $delta.ToString()) -match '(?i)setup required|setup.*fail|helper.*(?:fail|cancel)|orchestrator_helper|unelevated|fallback|降级'
    $record.configUnchanged = (Get-FileHash -LiteralPath $config).Hash -eq $configBefore
    $record.actualConfigurationVerified = $false
    $record.acceptance = 'NOT_YET_REVIEWED; output and exit code alone are not proof of sandbox mode or full acceptance'
    $record.finishedAt = [DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $recordDirectory 'result.json') -Encoding utf8
    if ($null -ne $process) { $process.Dispose() }
    Write-Host "Recorded check: $recordDirectory"
    Write-Host "Status: $($record.status); exit: $($record.exitCode); timed out: $($record.timedOut). No model was called."
}
