# Dump the real PowerShell surface of this machine as JSON.
#
# This is the *external* data source for the independent round: the command
# names, parameter names and paths come from Windows itself, not from a template
# table written by the plugin author. Run once; the result is cached as
# test/independent/surface.json.

[CmdletBinding()]
param([string] $OutFile = 'surface.json')

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$commands = Get-Command -CommandType Cmdlet, Function, Alias -ErrorAction SilentlyContinue |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.Name) } |
    Select-Object -First 700 |
    ForEach-Object {
        $params = @()
        if ($null -ne $_.Parameters) {
            $params = @($_.Parameters.Keys | Where-Object { $_ -notmatch '^(Verbose|Debug|ErrorAction|WarningAction|InformationAction|ProgressAction|ErrorVariable|WarningVariable|InformationVariable|OutVariable|OutBuffer|PipelineVariable)$' } | Select-Object -First 12)
        }
        [pscustomobject]@{
            name   = $_.Name
            module = [string]$_.Source
            params = $params
        }
    }

$paths = @()
$roots = @('C:\Windows\System32', 'C:\Windows', 'C:\Program Files', 'C:\Users\Public')
foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root) {
        $paths += @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue |
            Select-Object -First 120 |
            ForEach-Object { $_.FullName })
    }
}

$payload = [pscustomobject]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    psVersion   = $PSVersionTable.PSVersion.ToString()
    commands    = @($commands)
    paths       = @($paths | Select-Object -Unique)
}

$json = $payload | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $OutFile), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("commands={0} paths={1}" -f $payload.commands.Count, $payload.paths.Count)
