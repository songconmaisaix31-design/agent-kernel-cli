#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'check-windows-sandbox.ps1'
$source = Get-Content -LiteralPath $scriptPath -Raw
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

# Load only the decision function and guards; never invoke the sandbox runner.
$functionAst = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SandboxCheckDecision' }, $false)
if ($null -eq $functionAst) { throw 'Decision function missing.' }
. ([scriptblock]::Create($functionAst.Extent.Text))
$preflightGuard = $ast.Find({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if (-not $decision.allowedToRun)') }, $false)
$entryGuard = $ast.Find({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if (-not $entryDecision.allowedToRun)') }, $true)
if ($null -eq $preflightGuard -or $null -eq $entryGuard) { throw 'Execution guard missing.' }
$entryStart = $source.IndexOf('    $entryContext = @{}', [StringComparison]::Ordinal)
$entryEnd = $source.IndexOf('    $stdoutTask = $process.StandardOutput', [StringComparison]::Ordinal)
if ($entryStart -lt 0 -or $entryEnd -le $entryStart) { throw 'Entrypoint decision block missing.' }
$entryBlock = [scriptblock]::Create($source.Substring($entryStart, $entryEnd - $entryStart))
$results = [Collections.Generic.List[object]]::new()

function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -cne $Expected) { throw "$Label expected '$Expected', got '$Actual'." }
}

function Test-Decision([string]$Name, [hashtable]$Changes, [bool]$Ordinary, [bool]$Allowed, [bool]$Strict, [string]$Ownership, [string]$Reason = '') {
    $context = @{
        jobQuerySucceeded = $true; insideAnyJob = $true
        ancestorQuerySucceeded = $true; developmentAncestor = $false
        privilegeQuerySucceeded = $true; elevated = $false
    }
    foreach ($key in $Changes.Keys) { $context[$key] = $Changes[$key] }
    $decision = Get-SandboxCheckDecision $context -OrdinaryTerminalDiagnostic:$Ordinary
    Assert-Equal $decision.allowedToRun $Allowed "${Name}: allow"
    Assert-Equal $decision.eligibleForIndependentCheck $Strict "${Name}: strict"
    Assert-Equal $decision.jobOwnership $Ownership "${Name}: ownership"
    Assert-Equal $decision.manualLaunchAcknowledged $Ordinary "${Name}: caller declaration"
    if ($Reason -and $decision.stopReasons -notcontains $Reason) { throw "$Name missing stop reason: $Reason" }
    $preflightPath = 'fixture-only-no-file'
    $stopped = $false
    try { & ([scriptblock]::Create($preflightGuard.Extent.Text)) | Out-Null }
    catch {
        if ($_.Exception.Message -notlike 'Preflight stopped:*') { throw }
        $stopped = $true
    }
    Assert-Equal $stopped (-not $Allowed) "${Name}: actual preflight guard"
    $results.Add([ordered]@{ name = $Name; passed = $true })
}

Test-Decision 'unknown Job ordinary terminal' @{} $true $true $false 'unknown'
Test-Decision 'unknown Job strict mode' @{} $false $false $false 'unknown' 'unknown_outer_job_requires_explicit_ordinary_terminal_mode'
Test-Decision 'no Job strict mode' @{ insideAnyJob = $false } $false $true $true 'none'
Test-Decision 'no Job ordinary mode' @{ insideAnyJob = $false } $true $true $true 'none'
Test-Decision 'development ancestor ordinary mode' @{ developmentAncestor = $true } $true $false $false 'unknown' 'known_development_ancestor'
Test-Decision 'development ancestor without Job' @{ developmentAncestor = $true; insideAnyJob = $false } $true $false $false 'none' 'known_development_ancestor'
Test-Decision 'development ancestor strict mode' @{ developmentAncestor = $true } $false $false $false 'unknown' 'known_development_ancestor'
Test-Decision 'Job query failure' @{ jobQuerySucceeded = $false; insideAnyJob = $null } $true $false $false 'unknown' 'job_query_failed'
Test-Decision 'Job query failed with stale false' @{ jobQuerySucceeded = $false; insideAnyJob = $false } $true $false $false 'unknown' 'job_query_failed'
Test-Decision 'Job query missing value' @{ insideAnyJob = $null } $true $false $false 'unknown' 'job_query_failed'
Test-Decision 'ancestor query failure' @{ ancestorQuerySucceeded = $false; developmentAncestor = $null } $true $false $false 'unknown' 'ancestor_query_failed'
Test-Decision 'ancestor query failed with stale false' @{ ancestorQuerySucceeded = $false } $true $false $false 'unknown' 'ancestor_query_failed'
Test-Decision 'administrator ordinary mode' @{ elevated = $true } $true $false $false 'unknown' 'administrator_process'
Test-Decision 'administrator strict mode without Job' @{ elevated = $true; insideAnyJob = $false } $false $false $false 'none' 'administrator_process'
Test-Decision 'privilege query failure' @{ privilegeQuerySucceeded = $false; elevated = $null } $true $false $false 'unknown' 'privilege_query_failed'

foreach ($case in @(
    @{ name = 'child inherits unknown Job ordinary mode'; ordinary = $true; known = $true; inside = $true; allowed = $true },
    @{ name = 'child unknown Job strict mode'; ordinary = $false; known = $true; inside = $true; allowed = $false },
    @{ name = 'child query failed ordinary mode'; ordinary = $true; known = $false; inside = $null; allowed = $false },
    @{ name = 'child has no Job but parent unknown'; ordinary = $true; known = $true; inside = $false; allowed = $true }
)) {
    $context = @{
        jobQuerySucceeded = $true; insideAnyJob = $true
        ancestorQuerySucceeded = $true; developmentAncestor = $false
        privilegeQuerySucceeded = $true; elevated = $false
    }
    $OrdinaryTerminalDiagnostic = $case.ordinary
    $decision = Get-SandboxCheckDecision $context -OrdinaryTerminalDiagnostic:$OrdinaryTerminalDiagnostic
    $entryJobKnown = $case.known
    $record = [ordered]@{ entryInAnyJob = $case.inside }
    . $entryBlock
    Assert-Equal $entryDecision.allowedToRun $case.allowed "$($case.name): allow"
    Assert-Equal $record.strictIndependenceProven $false "$($case.name): strict proof"
    $stopped = $false
    try { & ([scriptblock]::Create($entryGuard.Extent.Text)) | Out-Null }
    catch {
        if ($_.Exception.Message -notlike 'Entrypoint check stopped:*') { throw }
        $stopped = $true
    }
    Assert-Equal $stopped (-not $case.allowed) "$($case.name): actual child guard"
    $results.Add([ordered]@{ name = $case.name; passed = $true })
}

foreach ($functionName in @('Protect-CheckText', 'Get-SandboxCheckFailureSummary')) {
    $definition = $ast.Find({ param($candidate) $candidate -is [Management.Automation.Language.FunctionDefinitionAst] -and $candidate.Name -eq $functionName }, $false)
    if ($null -eq $definition) { throw "Missing function: $functionName" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$argumentAst = $ast.Find({ param($candidate) $candidate -is [Management.Automation.Language.AssignmentStatementAst] -and $candidate.Left.Extent.Text -eq '$arguments' }, $false)
$startInfoStart = $source.IndexOf('    $startInfo = [Diagnostics.ProcessStartInfo]::new()', [StringComparison]::Ordinal)
$startInfoEnd = $source.IndexOf('    $process = [Diagnostics.Process]::new()', [StringComparison]::Ordinal)
if ($null -eq $argumentAst -or $startInfoStart -lt 0 -or $startInfoEnd -le $startInfoStart) { throw 'Launch argument block missing.' }
$argumentBlock = [scriptblock]::Create($argumentAst.Extent.Text)
$startInfoBlock = [scriptblock]::Create($source.Substring($startInfoStart, $startInfoEnd - $startInfoStart))

# A local Node fixture receives the runner's argv; Codex and the sandbox never start.
$fixtureRoot = Join-Path $PSScriptRoot ('argv-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$entry = Join-Path $fixtureRoot "entry space 中文's.cjs"
$practiceDirectory = Join-Path $fixtureRoot "practice space 中文's"
New-Item -ItemType Directory -Path $practiceDirectory | Out-Null
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$shell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
try {
    'process.stdout.write(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));' | Set-Content -LiteralPath $entry -Encoding utf8
    foreach ($trailingSeparator in @($false, $true)) {
        $practice = if ($trailingSeparator) { $practiceDirectory + [IO.Path]::DirectorySeparatorChar } else { $practiceDirectory }
        . $argumentBlock
        . $startInfoBlock
        Assert-Equal $startInfo.FileName $node 'Node executable'
        Assert-Equal $startInfo.WorkingDirectory $practice 'working directory argument'
        Assert-Equal $startInfo.UseShellExecute $false 'no shell string parsing'
        $startInfo.CreateNoWindow = $true
        $probe = [Diagnostics.Process]::new()
        $probe.StartInfo = $startInfo
        try {
            if (-not $probe.Start()) { throw 'Argv fixture did not start.' }
            $outputTask = $probe.StandardOutput.ReadToEndAsync()
            $errorTask = $probe.StandardError.ReadToEndAsync()
            if (-not $probe.WaitForExit(10000)) { throw 'Argv fixture timed out.' }
            Assert-Equal $probe.ExitCode 0 'Argv fixture exit'
            if (-not $outputTask.Wait(2000) -or -not $errorTask.Wait(2000)) { throw 'Argv fixture capture incomplete.' }
            Assert-Equal $errorTask.Result '' 'Argv fixture stderr'
            $received = $outputTask.Result | ConvertFrom-Json
            $expected = @('sandbox', '--permission-profile', ':read-only', '-c', 'windows.sandbox="elevated"', '-C', $practice,
                '--', $shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "Write-Output 'sandbox-ready'")
            Assert-Equal ($received.argv | ConvertTo-Json -Compress) ($expected | ConvertTo-Json -Compress) 'received argv'
            Assert-Equal $received.cwd $practiceDirectory 'received cwd'
            $results.Add([ordered]@{ name = "real argv transport, trailing separator=$trailingSeparator"; passed = $true })
        } finally {
            if ($probe.Id -and -not $probe.HasExited) { $probe.Kill($true); [void]$probe.WaitForExit(5000) }
            $probe.Dispose()
        }
    }
} finally {
    if (Test-Path -LiteralPath $entry) { Remove-Item -LiteralPath $entry }
    Remove-Item -LiteralPath $practiceDirectory
    Remove-Item -LiteralPath $fixtureRoot
}

$missingProfile = "error: the following required arguments were not provided:`n  --permission-profile <NAME>"
$summaryRecord = @{ status = 'FAILED'; stderrCaptureComplete = $true; error = $null }
$summary = @(Get-SandboxCheckFailureSummary $summaryRecord $missingProfile)
Assert-Equal ($summary -join "`n") $missingProfile 'original parser error visible'
$results.Add([ordered]@{ name = 'failure summary preserves parser error'; passed = $true })

$summary = @(Get-SandboxCheckFailureSummary $summaryRecord "error: invalid option`nAuthorization: Bearer fixture-secret`napi_key=fixture-secret`npassword=fixture-secret`nsandbox-secrets hidden`n--permission-profile <NAME>")
Assert-Equal ($summary -match 'fixture-secret|sandbox-secrets').Count 0 'sensitive lines omitted'
Assert-Equal ($summary -match '^\[sensitive diagnostic line omitted\]$').Count 4 'redaction count'
$results.Add([ordered]@{ name = 'failure summary redacts sensitive lines'; passed = $true })

$summary = @(Get-SandboxCheckFailureSummary $summaryRecord ((1..12 | ForEach-Object { 'x' * 600 }) -join "`n"))
Assert-Equal $summary.Count 8 'summary line limit'
Assert-Equal ($summary | Where-Object { $_.Length -gt 412 }).Count 0 'summary line length'
$results.Add([ordered]@{ name = 'failure summary bounded'; passed = $true })

Assert-Equal (@(Get-SandboxCheckFailureSummary $summaryRecord '') -join '') 'stderr was captured but empty.' 'empty stderr'
$summaryRecord.stderrCaptureComplete = $false
Assert-Equal (@(Get-SandboxCheckFailureSummary $summaryRecord 'partial output') -join '') 'stderr was not captured completely; inspect the result record.' 'uncaptured stderr'
$summaryRecord.status = 'CHECK_ERROR'
$summaryRecord.error = 'launch failed'
Assert-Equal (@(Get-SandboxCheckFailureSummary $summaryRecord '')[0]) 'launch failed' 'script exception visible'
$results.Add([ordered]@{ name = 'empty and uncaptured stderr remain distinct from script errors'; passed = $true })

$summaryRecord.status = 'EXITED_REVIEW_REQUIRED'
Assert-Equal (@(Get-SandboxCheckFailureSummary $summaryRecord $missingProfile)).Count 0 'no failure summary on review-required exit'
$results.Add([ordered]@{ name = 'review-required exit has no failure summary'; passed = $true })

[ordered]@{
    fixtureOnly = $true; testsPassed = $results.Count; tests = $results
    actualSandboxCommandsStarted = 0; modelTasksSubmitted = 0
} | ConvertTo-Json -Depth 5
