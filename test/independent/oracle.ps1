<#
.SYNOPSIS
    Independent oracle: parse command lines with PowerShell's own parser and
    report the command names each line actually invokes.

.DESCRIPTION
    The guard's analyzer is a hand-written tokenizer. This oracle is the
    opposite: it asks the language's own parser what the text means. One side
    can be wrong, but not in the same way, which is the point of a cross-check.

    Input  (stdin, UTF-8): {"items": ["<command>", ...]}
    Output (stdout):       {"results": [{"i":0,"names":["remove-item"],
                                          "args":["C:\\x"],"deleteLike":true,
                                          "errors":0}]}
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Read-Stdin {
    $stdin = [Console]::OpenStandardInput()
    $reader = New-Object System.IO.StreamReader($stdin, (New-Object System.Text.UTF8Encoding($false)))
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

# Command names Windows itself treats as deletion or erasure, including the
# aliases that ship with Windows PowerShell.
$deleteNames = @(
    'remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir', 'unlink',
    'clear-content', 'clc', 'remove-itemproperty', 'rp',
    'remove-localuser', 'remove-localgroupmember', 'remove-aduser',
    'remove-service', 'remove-printer', 'remove-printerport', 'remove-pnpdevice',
    'remove-partition', 'remove-disk', 'remove-eventlog', 'clear-eventlog',
    'clear-recyclebin', 'remove-ciminstance',
    'unregister-scheduledtask', 'format-volume', 'clear-disk', 'initialize-disk'
)

# Arguments that make an otherwise innocent command destructive.
$deleteArgs = @('/delete', '-delete', '/mir', '/purge', 'clean')

$raw = Read-Stdin
if ([string]::IsNullOrWhiteSpace($raw)) { [Console]::Out.Write('{"results":[]}'); exit 0 }
$request = $raw | ConvertFrom-Json
$items = @($request.items)

$results = New-Object System.Collections.ArrayList

for ($i = 0; $i -lt $items.Count; $i++) {
    $text = [string]$items[$i]
    $names = New-Object System.Collections.ArrayList
    $operands = New-Object System.Collections.ArrayList
    $deleteLike = $false
    $errorCount = 0

    try {
        $tokens = $null
        $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
        if ($null -ne $errors) { $errorCount = @($errors).Count }

        $commandAsts = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
        foreach ($commandAst in $commandAsts) {
            $element = $commandAst.GetCommandName()
            if (-not [string]::IsNullOrWhiteSpace($element)) {
                $lower = $element.ToLowerInvariant()
                [void]$names.Add($lower)
                if ($deleteNames -contains $lower) { $deleteLike = $true }
            }
            foreach ($element2 in $commandAst.CommandElements) {
                $value = $null
                if ($element2 -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $value = $element2.Value }
                elseif ($element2 -is [System.Management.Automation.Language.CommandParameterAst]) { $value = $element2.ParameterName }
                if ($null -ne $value) {
                    [void]$operands.Add([string]$value)
                    $lowerValue = ([string]$value).ToLowerInvariant()
                    if ($deleteArgs -contains $lowerValue) { $deleteLike = $true }
                }
            }
        }
    } catch {
        $errorCount = 1
    }

    [void]$results.Add([pscustomobject]@{
        i          = $i
        names      = @($names.ToArray())
        args       = @($operands | Select-Object -First 12)
        deleteLike = $deleteLike
        errors     = $errorCount
    })
}

$reply = [pscustomobject]@{ results = @($results.ToArray()) } | ConvertTo-Json -Depth 5 -Compress
[Console]::Out.Write($reply)
