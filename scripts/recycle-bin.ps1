<#
.SYNOPSIS
    Recycle-bin bridge for dsh-delete-guard-plus.

.DESCRIPTION
    Reads one JSON request from standard input and writes one JSON reply to
    standard output. Two operations:

        { "op": "recycle", "paths": ["C:\\tmp\\a.txt"] }
            -> { "recycled": [...], "failures": [{ "path": ..., "error": ... }] }

        { "op": "usage", "drive": "C:" }
            -> { "items": <int>, "bytes": <int> }

    Moving a file to the Recycle Bin is not a rename: Windows keeps a
    per-volume $Recycle.Bin\<sid>\ store plus $I/$R metadata pairs, and
    hand-rolling that corrupts the bin. This script therefore calls the same
    Win32 API Explorer uses (SHFileOperationW with FOF_ALLOWUNDO) through
    Microsoft.VisualBasic.FileIO.FileSystem.

    Two refusals are deliberate: a UNC share and a FAT/exFAT volume have no
    Recycle Bin, and SHFileOperationW erases there while still reporting
    success. Recoverability is the entire point, so those fail loudly.

.NOTES
    Written by DSH. PowerShell 5.1 compatible: no ternary, no ??, no -Parallel.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {
    # A host without a console can refuse this; JSON output still works.
}

function Write-Reply {
    param([Parameter(Mandatory = $true)] $Payload)

    $json = $Payload | ConvertTo-Json -Compress -Depth 8
    [Console]::Out.Write($json)
    [Console]::Out.Flush()
}

function Read-Request {
    $stdin = [Console]::OpenStandardInput()
    $reader = New-Object System.IO.StreamReader($stdin, (New-Object System.Text.UTF8Encoding($false)))
    try {
        $text = $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw 'empty request on stdin'
    }
    return ($text | ConvertFrom-Json)
}

function Get-VolumeKind {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ($Path.StartsWith('\\')) { return 'unc' }

    $root = [System.IO.Path]::GetPathRoot($Path)
    if ([string]::IsNullOrEmpty($root) -or $root.StartsWith('\\')) { return 'unc' }

    $letter = $root.TrimEnd('\').TrimEnd(':')
    if ([string]::IsNullOrEmpty($letter)) { return 'unknown' }

    try {
        $volume = Get-Volume -DriveLetter $letter -ErrorAction Stop
        return [string]$volume.FileSystem
    } catch {
        try {
            $info = New-Object System.IO.DriveInfo($letter)
            return [string]$info.DriveFormat
        } catch {
            return 'unknown'
        }
    }
}

function Test-RecyclableVolume {
    param([Parameter(Mandatory = $true)][string] $Path)

    $kind = Get-VolumeKind -Path $Path
    if ($kind -eq 'unc') {
        return 'a UNC share has no Recycle Bin, so this would be a permanent erase'
    }
    if ($kind -match '^(FAT|FAT32|exFAT)$') {
        return "volume file system is $kind, which has no Recycle Bin, so this would be a permanent erase"
    }
    return $null
}

function Invoke-Recycle {
    param([Parameter(Mandatory = $true)] $Request)

    $recycled = New-Object System.Collections.ArrayList
    $failures = New-Object System.Collections.ArrayList

    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop

    foreach ($raw in @($Request.paths)) {
        $original = [string]$raw
        if ([string]::IsNullOrWhiteSpace($original)) {
            [void]$failures.Add(@{ path = ''; error = 'empty path' })
            continue
        }

        try {
            $full = [System.IO.Path]::GetFullPath($original)
        } catch {
            [void]$failures.Add(@{ path = $original; error = "unresolvable path: $($_.Exception.Message)" })
            continue
        }

        $isFile = [System.IO.File]::Exists($full)
        $isDir = [System.IO.Directory]::Exists($full)
        if (-not $isFile -and -not $isDir) {
            [void]$failures.Add(@{ path = $full; error = 'no such file or directory' })
            continue
        }

        $refusal = Test-RecyclableVolume -Path $full
        if ($null -ne $refusal) {
            [void]$failures.Add(@{ path = $full; error = $refusal })
            continue
        }

        try {
            if ($isDir) {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
                    $full,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
            } else {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                    $full,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
            }
        } catch {
            [void]$failures.Add(@{ path = $full; error = $_.Exception.Message })
            continue
        }

        if ([System.IO.File]::Exists($full) -or [System.IO.Directory]::Exists($full)) {
            [void]$failures.Add(@{ path = $full; error = 'still present after the recycle request; it was not deleted' })
            continue
        }

        [void]$recycled.Add($full)
    }

    return @{
        recycled = @($recycled.ToArray())
        failures = @($failures.ToArray())
    }
}

function Invoke-Usage {
    param($Request)

    $drive = ''
    if ($null -ne $Request -and $null -ne $Request.drive -and -not [string]::IsNullOrWhiteSpace([string]$Request.drive)) {
        $drive = [string]$Request.drive
    } else {
        $drive = [string]$env:SystemDrive
    }

    $letter = $drive.Replace(':', '').Trim()
    if ([string]::IsNullOrEmpty($letter)) { $letter = 'C' }
    $letter = $letter.Substring(0, 1).ToUpperInvariant()

    $bin = $letter + ':\$Recycle.Bin'
    $items = 0
    $bytes = 0

    if (Test-Path -LiteralPath $bin) {
        # $R entries are the payloads ($I entries are their metadata records).
        # Directories count as items but contribute no Length.
        $payloads = @(Get-ChildItem -LiteralPath $bin -Force -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name.StartsWith('$R') })
        $items = $payloads.Count
        $files = @($payloads | Where-Object { -not $_.PSIsContainer })
        if ($files.Count -gt 0) {
            $sum = ($files | Measure-Object -Property Length -Sum).Sum
            if ($null -ne $sum) { $bytes = [int64]$sum }
        }
    }

    return @{ items = $items; bytes = $bytes; drive = $letter + ':' }
}

try {
    $request = Read-Request
} catch {
    Write-Reply -Payload @{ error = "bridge: $($_.Exception.Message)"; recycled = @(); failures = @() }
    exit 2
}

$op = ''
if ($null -ne $request -and $null -ne $request.op) { $op = [string]$request.op }

try {
    switch ($op) {
        'recycle' { Write-Reply -Payload (Invoke-Recycle -Request $request) }
        'usage'   { Write-Reply -Payload (Invoke-Usage -Request $request) }
        default   { Write-Reply -Payload @{ error = "unknown op: '$op'"; recycled = @(); failures = @() }; exit 3 }
    }
} catch {
    Write-Reply -Payload @{ error = "bridge: $($_.Exception.Message)"; recycled = @(); failures = @() }
    exit 1
}

exit 0
