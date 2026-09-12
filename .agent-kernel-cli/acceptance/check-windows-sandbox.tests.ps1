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

[ordered]@{
    fixtureOnly = $true; testsPassed = $results.Count; tests = $results
    actualSandboxCommandsStarted = 0; modelTasksSubmitted = 0
} | ConvertTo-Json -Depth 5
