param([Parameter(Mandatory=$true)][string]$SpecPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'job.cs')
    $spec = Get-Content -Raw -Encoding UTF8 -LiteralPath $SpecPath | ConvertFrom-Json
    $outcome = [KernelJob]::Run($spec.executable, [string[]]$spec.args, $spec.cwd,
        $spec.stdinPath, $spec.stdoutPath, $spec.stderrPath, $spec.timeoutMs, $spec.outputLimitBytes)
    [pscustomobject]@{
        type = 'exited'; reason = $outcome.reason
        exitCode = $(if ($outcome.exitCode -lt 0) { $null } else { $outcome.exitCode })
        verified = $outcome.verified; remaining = $outcome.remaining; detail = $outcome.detail
    } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
