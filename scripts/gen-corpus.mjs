/**
 * Corpus generator for dsh-delete-guard-plus.
 *
 * One round = 100,000 Windows-shaped command lines from a single domain, plus
 * a label for each line:
 *
 *   SAFE    the guard must not block it
 *   DANGER  the guard must block it (the tag names the failure family)
 *
 * Rounds are independent: each one draws from its own command families and its
 * own parameter pools, so round 7 is not round 3 with different numbers. The
 * only shared machinery is the hazard mutator, because the same eight ways of
 * destroying a path apply to every domain.
 *
 * Nothing here is executed. The output is text; the analyzer reads it.
 *
 * Usage: node scripts/gen-corpus.mjs <round>
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus')
const LINES_PER_ROUND = 100_000
const HAZARD_SHARE = 0.03

/** Deterministic PRNG so a round regenerates byte-identically. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PROJ = [
  'orion',
  'atlas',
  'kepler',
  'vostok',
  'meridian',
  'harbor',
  'lattice',
  'quartz',
  'delta',
  'sonar',
  'perigee',
  'vertex',
]
const USER = ['MrL', 'dev', 'build', 'svc-agent', 'ops']
const HOST = ['WS-01', 'LAB-07', 'BUILD-12', 'EDGE-03', 'FS-09']
const SVC = [
  'wuauserv',
  'Spooler',
  'W32Time',
  'BITS',
  'WinRM',
  'LanmanServer',
  'EventLog',
  'mpssvc',
  'Dhcp',
  'TermService',
]
const ADAPTER = ['Ethernet', 'Wi-Fi', 'vEthernet (Default Switch)', 'Tailscale', 'Bluetooth Network Connection']
const PORT = ['80', '443', '445', '3389', '5985', '8080', '5432', '1433', '22', '53']
const EXT = ['log', 'tmp', 'json', 'yaml', 'ps1', 'bat', 'cmd', 'txt', 'csv', 'bak', 'zip', 'dll', 'exe', 'md']
const DEEP = (rnd) =>
  `C:\\Users\\${USER[Math.floor(rnd() * USER.length)]}\\Documents\\${PROJ[Math.floor(rnd() * PROJ.length)]}\\src\\module-${String(
    Math.floor(rnd() * 400),
  ).padStart(3, '0')}\\file-${String(Math.floor(rnd() * 9000) + 1000)}`

const SAFE_PATH = (rnd) => `${DEEP(rnd)}.${EXT[Math.floor(rnd() * EXT.length)]}`
const DEEP_DIR = (rnd) => DEEP(rnd).replace(/\\file-\d+$/, `\\cache-${Math.floor(rnd() * 90)}`)

/** Quote a path the way a careful author would, or the way the model does. */
const QUOTES = [
  (p) => p,
  (p) => `"${p}"`,
  (p) => `'${p}'`,
  (p) => `cmd /c "${p}"`,
]

/** Windows-shaped read/write/inspect lines that must never be blocked. */
function safeFamilies(round) {
  const families = []
  const add = (fn) => families.push(fn)

  // ── 1. filesystem traversal, copy, move, metadata ──────────────────────
  if (round === 1) {
    add((rnd) => `Get-ChildItem -LiteralPath ${QUOTES[Math.floor(rnd() * 4)](DEEP_DIR(rnd))} -Recurse -File`)
    add((rnd) => `Get-ChildItem -Path ${SAFE_PATH(rnd)} -Force | Select-Object Name, Length, LastWriteTime`)
    add((rnd) => `Copy-Item -LiteralPath ${SAFE_PATH(rnd)} -Destination ${SAFE_PATH(rnd)} -Force`)
    add((rnd) => `Move-Item -LiteralPath ${SAFE_PATH(rnd)} -Destination ${SAFE_PATH(rnd)}`)
    add((rnd) => `Rename-Item -LiteralPath ${SAFE_PATH(rnd)} -NewName arch-${Math.floor(rnd() * 999)}.bak`)
    add((rnd) => `New-Item -ItemType Directory -Path ${DEEP_DIR(rnd)} -Force | Out-Null`)
    add((rnd) => `robocopy ${DEEP_DIR(rnd)} ${DEEP_DIR(rnd)} /E /R:1 /W:1 /NP /LOG:${SAFE_PATH(rnd)}`)
    add((rnd) => `xcopy ${DEEP_DIR(rnd)} ${DEEP_DIR(rnd)} /E /I /Y /Q`)
    add((rnd) => `Get-FileHash -Algorithm SHA256 -LiteralPath ${SAFE_PATH(rnd)} | Format-List`)
    add((rnd) => `(Get-Item -LiteralPath ${SAFE_PATH(rnd)}).Length`)
    add((rnd) => `Get-ChildItem -Path ${DEEP_DIR(rnd)} -Filter *.${EXT[Math.floor(rnd() * EXT.length)]} | Measure-Object -Sum Length`)
    add((rnd) => `Resolve-Path -LiteralPath ${SAFE_PATH(rnd)} | Select-Object -ExpandProperty Path`)
    add((rnd) => `Set-Content -LiteralPath ${SAFE_PATH(rnd)} -Value 'artifact ${Math.floor(rnd() * 9999)}' -Encoding utf8`)
    add((rnd) => `Add-Content -LiteralPath ${SAFE_PATH(rnd)} -Value (Get-Date -Format o)`)
    add((rnd) => `Get-ChildItem -Path ${DEEP_DIR(rnd)} -Recurse -Include *.log,*.tmp | Where-Object Length -gt 0`)
    add((rnd) => `icacls ${DEEP_DIR(rnd)}`)
    add((rnd) => `attrib ${SAFE_PATH(rnd)}`)
    add((rnd) => `tree ${DEEP_DIR(rnd)} /F /A`)
    add((rnd) => `dir ${DEEP_DIR(rnd)} /S /B /A-D`)
    add((rnd) => `where /R ${DEEP_DIR(rnd)} *.${EXT[Math.floor(rnd() * EXT.length)]}`)
  }

  // ── 2. processes, services, scheduled tasks ────────────────────────────
  if (round === 2) {
    add((rnd) => `Get-Process -Name ${PROJ[Math.floor(rnd() * PROJ.length)]} -ErrorAction SilentlyContinue`)
    add((rnd) => `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 15`)
    add((rnd) => `Get-Service -Name ${SVC[Math.floor(rnd() * SVC.length)]} | Select-Object Status, StartType`)
    add((rnd) => `sc.exe query ${SVC[Math.floor(rnd() * SVC.length)]}`)
    add((rnd) => `sc.exe qc ${SVC[Math.floor(rnd() * SVC.length)]}`)
    add((rnd) => `sc.exe start ${SVC[Math.floor(rnd() * SVC.length)]}`)
    add((rnd) => `Start-Service -Name ${SVC[Math.floor(rnd() * SVC.length)]} -ErrorAction Continue`)
    add((rnd) => `Restart-Service -Name ${SVC[Math.floor(rnd() * SVC.length)]} -Force`)
    add((rnd) => `Get-ScheduledTask -TaskPath '\\Microsoft\\Windows\\${PROJ[Math.floor(rnd() * PROJ.length)]}\\'`)
    add((rnd) => `schtasks /query /tn "\\Maintenance\\${PROJ[Math.floor(rnd() * PROJ.length)]}" /v /fo LIST`)
    add((rnd) => `schtasks /create /tn "\\Maintenance\\${PROJ[Math.floor(rnd() * PROJ.length)]}" /tr "${SAFE_PATH(rnd)}" /sc daily /st 0${Math.floor(rnd() * 9) + 1}:00 /f`)
    add((rnd) => `Get-CimInstance Win32_Process -Filter "Name='${PROJ[Math.floor(rnd() * PROJ.length)]}.exe'"`)
    add((rnd) => `Stop-Process -Id ${Math.floor(rnd() * 9000) + 1000} -ErrorAction SilentlyContinue`)
    add((rnd) => `Wait-Process -Name ${PROJ[Math.floor(rnd() * PROJ.length)]} -Timeout ${Math.floor(rnd() * 90) + 10}`)
    add((rnd) => `Get-Job | Format-Table -AutoSize`)
    add((rnd) => `tasklist /FI "IMAGENAME eq ${PROJ[Math.floor(rnd() * PROJ.length)]}.exe" /FO TABLE`)
    add((rnd) => `taskkill /PID ${Math.floor(rnd() * 9000) + 1000} /T /F`)
  }

  // ── 3. network ─────────────────────────────────────────────────────────
  if (round === 3) {
    add((rnd) => `Test-NetConnection -ComputerName ${HOST[Math.floor(rnd() * HOST.length)]} -Port ${PORT[Math.floor(rnd() * PORT.length)]}`)
    add((rnd) => `Test-Connection -ComputerName ${HOST[Math.floor(rnd() * HOST.length)]} -Count 3 -Quiet`)
    add((rnd) => `Get-NetAdapter -Name '${ADAPTER[Math.floor(rnd() * ADAPTER.length)]}' | Select-Object Status, LinkSpeed`)
    add((rnd) => `Get-NetIPConfiguration -InterfaceAlias '${ADAPTER[Math.floor(rnd() * ADAPTER.length)]}'`)
    add((rnd) => `ipconfig /allcompartments /all`)
    add((rnd) => `netstat -ano | findstr :${PORT[Math.floor(rnd() * PORT.length)]}`)
    add((rnd) => `netsh interface ipv4 show config name="${ADAPTER[Math.floor(rnd() * ADAPTER.length)]}"`)
    add((rnd) => `netsh advfirewall firewall show rule name=all`)
    add((rnd) => `Resolve-DnsName -Name ${PROJ[Math.floor(rnd() * PROJ.length)]}.example.com -Type A`)
    add((rnd) => `nslookup ${PROJ[Math.floor(rnd() * PROJ.length)]}.example.com`)
    add((rnd) => `Invoke-WebRequest -Uri "https://${PROJ[Math.floor(rnd() * PROJ.length)]}.example.com/health" -UseBasicParsing -TimeoutSec ${Math.floor(rnd() * 30) + 5}`)
    add((rnd) => `curl.exe -sS -o NUL -w "%{http_code}" "https://${PROJ[Math.floor(rnd() * PROJ.length)]}.example.com/ping"`)
    add((rnd) => `Get-NetTCPConnection -State Established | Select-Object -First 20 LocalPort, RemoteAddress`)
    add((rnd) => `Get-DnsClientCache | Select-Object -First 40`)
    add((rnd) => `route print -4`)
    add((rnd) => `arp -a`)
    add((rnd) => `ping -n 2 ${HOST[Math.floor(rnd() * HOST.length)]}`)
    add((rnd) => `tracert -h 8 -w 500 ${HOST[Math.floor(rnd() * HOST.length)]}`)
  }

  // ── 4. registry, policy, certificates ──────────────────────────────────
  if (round === 4) {
    add((rnd) => `Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\${PROJ[Math.floor(rnd() * PROJ.length)]}\\Config' -Name Version -ErrorAction SilentlyContinue`)
    add((rnd) => `Get-ItemPropertyValue -Path 'HKCU:\\Software\\${PROJ[Math.floor(rnd() * PROJ.length)]}' -Name LastRun`)
    add((rnd) => `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SVC[Math.floor(rnd() * SVC.length)]}" /v ImagePath`)
    add((rnd) => `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer" /s /f "${PROJ[Math.floor(rnd() * PROJ.length)]}"`)
    add((rnd) => `New-ItemProperty -Path 'HKCU:\\Software\\${PROJ[Math.floor(rnd() * PROJ.length)]}' -Name Trace -Value ${Math.floor(rnd() * 9)} -PropertyType DWord -Force`)
    add((rnd) => `Get-ChildItem -Path Cert:\\LocalMachine\\My | Select-Object Subject, NotAfter`)
    add((rnd) => `Get-ChildItem -Path Cert:\\CurrentUser\\Root | Where-Object NotAfter -lt (Get-Date).AddDays(30)`)
    add((rnd) => `certutil -store -user My`)
    add((rnd) => `certutil -L -store My`)
    add((rnd) => `Get-GPO -All -ErrorAction SilentlyContinue`)
    add((rnd) => `gpresult /r /scope:computer`)
    add((rnd) => `Get-ExecutionPolicy -List`)
    add((rnd) => `Get-AuthenticodeSignature -LiteralPath ${SAFE_PATH(rnd)} | Format-List`)
    add((rnd) => `Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Select-Object DisplayName`)
    add((rnd) => `reg export "HKCU\\Software\\${PROJ[Math.floor(rnd() * PROJ.length)]}" "${SAFE_PATH(rnd)}" /y`)
  }

  // ── 5. disks, volumes, storage ─────────────────────────────────────────
  if (round === 5) {
    add((rnd) => `Get-Disk | Select-Object Number, FriendlyName, Size, HealthStatus`)
    add((rnd) => `Get-Volume | Select-Object DriveLetter, FileSystem, SizeRemaining`)
    add((rnd) => `Get-Partition -DriveLetter C | Format-List`)
    add((rnd) => `Get-PhysicalDisk | Select-Object DeviceId, MediaType, OperationalStatus`)
    add((rnd) => `Get-Volume -DriveLetter C | Get-StorageReliabilityCounter`)
    add((rnd) => `chkdsk C: /scan`)
    add((rnd) => `fsutil volume diskfree C:`)
    add((rnd) => `fsutil fsinfo volumeinfo C:`)
    add((rnd) => `mountvol`)
    add((rnd) => `Get-ChildItem ${DEEP_DIR(rnd)} -Recurse | Measure-Object Length -Sum`)
    add((rnd) => `Optimize-Volume -DriveLetter C -Analyze -Verbose`)
    add((rnd) => `Get-ClusterSharedVolume -ErrorAction SilentlyContinue`)
    add((rnd) => `vssadmin list shadows`)
    add((rnd) => `Get-WmiObject Win32_LogicalDisk | Select-Object DeviceID, FreeSpace`)
  }

  // ── 6. accounts, identity, ACL ─────────────────────────────────────────
  if (round === 6) {
    add((rnd) => `whoami /all`)
    add((rnd) => `whoami /groups /fo csv`)
    add((rnd) => `net user ${USER[Math.floor(rnd() * USER.length)]}`)
    add((rnd) => `net localgroup administrators`)
    add((rnd) => `Get-LocalUser | Select-Object Name, Enabled, LastLogon`)
    add((rnd) => `Get-LocalGroupMember -Group Administrators`)
    add((rnd) => `Get-Acl -Path ${DEEP_DIR(rnd)} | Format-List`)
    add((rnd) => `icacls ${DEEP_DIR(rnd)} /T /C /L`)
    add((rnd) => `takeown /F ${SAFE_PATH(rnd)} /A /D Y`)
    add((rnd) => `Get-Acl -Path ${DEEP_DIR(rnd)} | Select-Object -ExpandProperty Access`)
    add((rnd) => `New-Item -ItemType Directory -Path ${DEEP_DIR(rnd)} -Force; icacls ${DEEP_DIR(rnd)} /grant "${USER[0]}:(OI)(CI)M"`)
    add((rnd) => `klist -li 0x3e7`)
    add((rnd) => `Get-CimInstance Win32_UserAccount -Filter "LocalAccount=True" | Select-Object Name, SID`)
    add((rnd) => `gpupdate /target:user /force`)
  }

  // ── 7. package managers and dev toolchains ─────────────────────────────
  if (round === 7) {
    add((rnd) => `winget list --name ${PROJ[Math.floor(rnd() * PROJ.length)]}`)
    add((rnd) => `winget search --name ${PROJ[Math.floor(rnd() * PROJ.length)]} --accept-source-agreements`)
    add((rnd) => `winget upgrade --all --include-unknown --accept-package-agreements --accept-source-agreements`)
    add((rnd) => `choco list --local-only`)
    add((rnd) => `git -C ${DEEP_DIR(rnd)} status --short --branch`)
    add((rnd) => `git -C ${DEEP_DIR(rnd)} log --oneline -n 20`)
    add((rnd) => `git -C ${DEEP_DIR(rnd)} fetch --all --prune`)
    add((rnd) => `npm --prefix ${DEEP_DIR(rnd)} ci --no-audit --no-fund`)
    add((rnd) => `npm --prefix ${DEEP_DIR(rnd)} run build --if-present`)
    add((rnd) => `node --version; npm --version`)
    add((rnd) => `python -m pip list --outdated`)
    add((rnd) => `python -m venv ${DEEP_DIR(rnd)}\\venv`)
    add((rnd) => `dotnet build ${DEEP_DIR(rnd)}\\${PROJ[Math.floor(rnd() * PROJ.length)]}.sln -c Release --nologo`)
    add((rnd) => `dotnet test ${DEEP_DIR(rnd)}\\tests.csproj --no-build`)
    add((rnd) => `msbuild ${DEEP_DIR(rnd)}\\app.csproj /t:Build /p:Configuration=Release /v:m`)
    add((rnd) => `pnpm --dir ${DEEP_DIR(rnd)} install --frozen-lockfile`)
    add((rnd) => `tsc --noEmit -p ${DEEP_DIR(rnd)}\\tsconfig.json`)
  }

  // ── 8. logs, events, diagnostics ───────────────────────────────────────
  if (round === 8) {
    add((rnd) => `Get-WinEvent -LogName System -MaxEvents 50 | Select-Object TimeCreated, Id, LevelDisplayName`)
    add((rnd) => `Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2; StartTime=(Get-Date).AddHours(-${Math.floor(rnd() * 23) + 1})} -MaxEvents 40`)
    add((rnd) => `wevtutil qe Security /c:20 /rd:true /f:text`)
    add((rnd) => `wevtutil gl System`)
    add((rnd) => `Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 3`)
    add((rnd) => `Get-Counter -ListSet Memory | Select-Object -ExpandProperty Counter`)
    add((rnd) => `sfc /scannow`)
    add((rnd) => `DISM /Online /Cleanup-Image /ScanHealth`)
    add((rnd) => `Get-EventLog -LogName Application -Newest 25 -ErrorAction SilentlyContinue`)
    add((rnd) => `Measure-Command { Get-ChildItem ${DEEP_DIR(rnd)} -Recurse }`)
    add((rnd) => `Get-Process | Measure-Object -Property WorkingSet64 -Sum`)
    add((rnd) => `Get-CimInstance Win32_OperatingSystem | Select-Object LastBootUpTime, TotalVisibleMemorySize`)
  }

  // ── 9. hardware, devices, printing, WMI ────────────────────────────────
  if (round === 9) {
    add((rnd) => `Get-CimInstance Win32_PnPEntity | Where-Object Status -ne 'OK' | Select-Object -First 20 Name`)
    add((rnd) => `Get-PnpDevice -Class ${['Net', 'DiskDrive', 'USB', 'Display'][Math.floor(rnd() * 4)]} | Select-Object Status, FriendlyName`)
    add((rnd) => `pnputil /enum-devices /connected`)
    add((rnd) => `Get-Printer | Select-Object Name, DriverName, PortName`)
    add((rnd) => `Get-PrintJob -PrinterName "${PROJ[Math.floor(rnd() * PROJ.length)]}-printer" -ErrorAction SilentlyContinue`)
    add((rnd) => `Get-CimInstance Win32_Printer | Select-Object Name, Shared`)
    add((rnd) => `Get-CimInstance Win32_BIOS | Select-Object SerialNumber, SMBIOSBIOSVersion`)
    add((rnd) => `Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, TotalPhysicalMemory`)
    add((rnd) => `Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion`)
    add((rnd) => `Get-WmiObject -Class Win32_Product -Filter "Name like '%${PROJ[Math.floor(rnd() * PROJ.length)]}%'" -ErrorAction SilentlyContinue`)
    add((rnd) => `Get-CimInstance -ClassName Win32_LogicalDiskToPartition`)
    add((rnd) => `Get-CimInstance Win32_StartupCommand | Select-Object Name, Command`)
  }

  // ── 10. text, encoding, archives, mixed dialects ───────────────────────
  if (round === 10) {
    add((rnd) => `chcp 65001`)
    add((rnd) => `Get-Content -LiteralPath ${SAFE_PATH(rnd)} -Encoding UTF8 -TotalCount 100`)
    add((rnd) => `Import-Csv -LiteralPath ${SAFE_PATH(rnd)} -Delimiter ';' | Select-Object -First 10`)
    add((rnd) => `ConvertFrom-Json (Get-Content -LiteralPath ${SAFE_PATH(rnd)} -Raw) | Select-Object version`)
    add((rnd) => `Get-Content -LiteralPath ${SAFE_PATH(rnd)} | Select-String -Pattern 'ERROR|WARN' -Context 1,1`)
    add((rnd) => `tar -czf ${SAFE_PATH(rnd)} -C ${DEEP_DIR(rnd)} .`)
    add((rnd) => `tar -xzf ${SAFE_PATH(rnd)} -C ${DEEP_DIR(rnd)}`)
    add((rnd) => `Compress-Archive -Path ${DEEP_DIR(rnd)} -DestinationPath ${SAFE_PATH(rnd)} -Force`)
    add((rnd) => `Expand-Archive -LiteralPath ${SAFE_PATH(rnd)} -DestinationPath ${DEEP_DIR(rnd)} -Force`)
    add((rnd) => `Get-FileHash -LiteralPath ${SAFE_PATH(rnd)} -Algorithm MD5 | Format-Table`)
    add((rnd) => `cmd /c "chcp 65001 >NUL && type ${SAFE_PATH(rnd)}"`)
    add((rnd) => `powershell -NoProfile -Command "Get-Content -LiteralPath '${SAFE_PATH(rnd)}' | Measure-Object -Line"`)
    add((rnd) => `[System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes('${SAFE_PATH(rnd)}')).Length`)
    add((rnd) => `Get-Content -LiteralPath ${SAFE_PATH(rnd)} -ReadCount 500 | ForEach-Object { $_.Count }`)
    add((rnd) => `Set-Content -LiteralPath ${SAFE_PATH(rnd)} -Value (Get-Content -LiteralPath ${SAFE_PATH(rnd)} -Raw) -Encoding UTF8`)
  }

  return families
}

/**
 * The eight ways a delete loses its mind.
 *
 * `paths: 'rootish'` hazards only make sense against a root-shaped operand —
 * labelling `rmdir /s /q C:\Users\…\file.txt` as a "root" hazard is how a
 * generator ends up reporting a false rule mismatch that is really a bad label.
 * `paths: 'any'` hazards are the plain-delete and mirror cases, where a deep
 * path is the correct operand.
 */
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)]
const ROOTISH = ['\\', 'C:\\', 'C:\\*', 'C:', '/', '~', '\\\\server\\share', '%TEMP%', '$env:SystemDrive']
const rootish = (rnd) => pick(rnd, ROOTISH)

const HAZARDS = [
  { tag: 'root', build: (rnd) => `rmdir /s /q ${rootish(rnd)}` },
  { tag: 'root', build: (rnd) => `rd /s /q "${rootish(rnd)}"` },
  { tag: 'root', build: (rnd) => `del /s /q ${rootish(rnd)}` },
  { tag: 'root', build: (rnd) => `Remove-Item -Recurse -Force ${rootish(rnd)}` },
  { tag: 'quoting', build: (rnd) => `cmd /c "rmdir /s /q \\"${rootish(rnd)}\\""` },
  { tag: 'quoting', build: () => 'cmd /c "del /s /q \\"%TEMP%\\x\\""' },
  { tag: 'unprovable', build: () => 'Remove-Item -Recurse -Force $target' },
  { tag: 'unprovable', build: () => 'rd /s /q %SystemDrive%' },
  { tag: 'protected', build: () => 'Remove-Item -Recurse -Force C:\\Windows\\Temp' },
  { tag: 'delete', build: (rnd) => `Remove-Item -Recurse -Force ${SAFE_PATH(rnd)} | Out-Null` },
  { tag: 'quoting', build: () => 'cmd /c "rmdir /s /q \\"$p\\""' },
  { tag: 'mirror', build: (rnd) => `robocopy C:\\empty ${SAFE_PATH(rnd)} /MIR` },
  { tag: 'unprovable', build: () => 'del /s /q "$p"\\*' },
  { tag: 'delete', build: (rnd) => `Remove-Item -LiteralPath "${SAFE_PATH(rnd)}"` },
]

/**
 * Natural, harmless tails that vary a line without changing what it does.
 *
 * Without them a narrow domain (round 3 has four read-only commands that take
 * no operand at all) cannot reach 97k distinct lines, and the generator burns
 * its whole iteration budget producing 492 of them.
 */
const TAILS = [
  '',
  ' | Out-Null',
  ' | Out-Host',
  ' 2>$null',
  ' -ErrorAction SilentlyContinue',
  ' | Format-Table -AutoSize',
  ' | Format-List',
  ' -Verbose',
]

/**
 * Harmless preference preambles, the way a real script starts a block. They add
 * variety to a domain whose commands take no operand at all (round 9's
 * `pnputil /enum-devices` is one line, forever) without changing behaviour.
 */
const PREFIXES = [
  '',
  "$ErrorActionPreference = 'Stop'; ",
  "$ErrorActionPreference = 'Continue'; ",
  "$ProgressPreference = 'SilentlyContinue'; ",
  "$VerbosePreference = 'SilentlyContinue'; ",
  "$WarningPreference = 'Continue'; ",
]

/**
 * Append natural variation to a generated line.
 * @param {string} command base command.
 * @param {() => number} rnd PRNG.
 * @returns {string} varied command.
 */
function vary(command, rnd) {
  const prefix = PREFIXES[Math.floor(rnd() * PREFIXES.length)]
  const tail = TAILS[Math.floor(rnd() * TAILS.length)]
  const first = Math.floor(rnd() * 200) + 1
  const numbered = rnd() < 0.5 ? ` | Select-Object -First ${first}` : ''
  return `${prefix}${command}${numbered}${tail}`
}

/**
 * Round-specific destructive shapes.
 *
 * A round is only worth running if it can produce failures the previous round
 * could not. These are the unrecoverable operations native to each domain:
 * they do not go through a file delete at all, so a guard that only knows
 * `Remove-Item` learns nothing from a registry round.
 */
const ROUND_HAZARDS = {
  // processes, services, scheduled tasks
  2: [
    { tag: 'delete', build: (rnd) => `sc.exe delete ${SVC[Math.floor(rnd() * SVC.length)]}` },
    { tag: 'delete', build: () => 'sc delete Spooler' },
    { tag: 'delete', build: (rnd) => `schtasks /delete /tn "\\Maintenance\\${PROJ[Math.floor(rnd() * PROJ.length)]}" /f` },
    { tag: 'delete', build: () => 'schtasks /Delete /TN "Microsoft\\Windows\\UpdateOrchestrator\\Reboot_AC" /F' },
    { tag: 'delete', build: () => 'Unregister-ScheduledTask -TaskName "Cleanup" -Confirm:$false' },
    { tag: 'delete', build: () => 'Remove-WmiObject -Class Win32_Service -Filter "Name=\'wuauserv\'"' },
  ],
  // network
  3: [
    { tag: 'delete', build: () => 'netsh advfirewall reset' },
    { tag: 'delete', build: () => 'netsh winsock reset' },
    { tag: 'delete', build: () => 'netsh int ip reset' },
    { tag: 'delete', build: () => 'Remove-NetFirewallRule -All' },
    { tag: 'delete', build: () => 'Get-NetFirewallRule | Remove-NetFirewallRule' },
    { tag: 'delete', build: (rnd) => `route delete 0.0.0.0 mask 0.0.0.0` },
  ],
  // registry, policy, certificates
  4: [
    { tag: 'delete', build: (rnd) => `reg delete "HKLM\\SOFTWARE\\${PROJ[Math.floor(rnd() * PROJ.length)]}" /f` },
    { tag: 'delete', build: () => 'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Updater /f' },
    { tag: 'delete', build: () => 'Remove-ItemProperty -Path "HKCU:\\Software\\Vendor" -Name License -Force' },
    { tag: 'delete', build: () => 'Remove-Item -Path "HKLM:\\SOFTWARE\\Classes\\CLSID\\{00000000-0000-0000-0000-000000000000}" -Recurse -Force' },
    { tag: 'delete', build: () => 'certutil -delstore My 1a2b3c4d' },
    { tag: 'delete', build: () => 'Remove-Item -Path Cert:\\LocalMachine\\My\\ABC123 -Force' },
    { tag: 'delete', build: () => 'secedit /configure /cfg baseline.inf /overwrite' },
  ],
  // disks, volumes, storage
  5: [
    { tag: 'delete', build: () => 'diskpart /s clean.txt' },
    { tag: 'delete', build: () => 'Clear-Disk -Number 1 -RemoveData -Confirm:$false' },
    { tag: 'delete', build: () => 'Format-Volume -DriveLetter D -FileSystem NTFS -Confirm:$false' },
    { tag: 'delete', build: () => 'vssadmin delete shadows /all /quiet' },
    { tag: 'delete', build: () => 'Remove-Partition -DriveLetter D -Confirm:$false' },
    { tag: 'delete', build: () => 'Initialize-Disk -Number 1 -PartitionStyle GPT' },
  ],
  // accounts, identity, ACL
  6: [
    { tag: 'delete', build: (rnd) => `net user ${USER[Math.floor(rnd() * USER.length)]} /delete` },
    { tag: 'delete', build: () => 'Remove-LocalUser -Name dev' },
    { tag: 'delete', build: () => 'Remove-LocalGroupMember -Group Administrators -Member dev' },
    { tag: 'delete', build: () => 'icacls C:\\Users\\MrL\\Documents /remove:g "Everyone" /T /C' },
    { tag: 'delete', build: () => 'Remove-Item -Path "C:\\Users\\dev" -Recurse -Force' },
  ],
  // package managers, dev toolchains
  7: [
    { tag: 'delete', build: () => 'git clean -fdx' },
    { tag: 'delete', build: () => 'git reset --hard HEAD~5' },
    { tag: 'delete', build: () => 'git branch -D release' },
    { tag: 'delete', build: () => 'git stash clear' },
    { tag: 'delete', build: () => 'git checkout -- .' },
    { tag: 'delete', build: () => 'git stash drop stash@{0}' },
  ],
  // logs, events, diagnostics
  8: [
    { tag: 'delete', build: () => 'wevtutil cl System' },
    { tag: 'delete', build: () => 'wevtutil clear-log Application' },
    { tag: 'delete', build: () => 'Clear-EventLog -LogName Security' },
    { tag: 'delete', build: () => 'Remove-EventLog -LogName Application' },
    { tag: 'delete', build: () => 'Remove-Item -Path C:\\Windows\\Logs\\CBS -Recurse -Force' },
  ],
  // hardware, devices, printing
  9: [
    { tag: 'delete', build: () => 'pnputil /delete-driver oem12.inf /uninstall /force' },
    { tag: 'delete', build: () => 'Remove-Printer -Name "HP-LaserJet"' },
    { tag: 'delete', build: () => 'Remove-PrinterPort -Name "IP_192.168.1.50"' },
    { tag: 'delete', build: () => 'Remove-PnpDevice -InstanceId "USB\\VID_1234" -Confirm:$false' },
    { tag: 'delete', build: () => 'pnputil /remove-device "PCI\\VEN_8086" /force' },
  ],
  // text, encoding, archives
  10: [
    { tag: 'delete', build: (rnd) => `Clear-Content -LiteralPath ${SAFE_PATH(rnd)}` },
    { tag: 'delete', build: (rnd) => `Set-Content -LiteralPath ${SAFE_PATH(rnd)} -Value $null` },
    { tag: 'delete', build: (rnd) => `Remove-Item -Path "${DEEP_DIR(rnd)}\\*" -Force` },
    { tag: 'delete', build: (rnd) => `cmd /c "copy NUL ${SAFE_PATH(rnd)} >NUL"` },
    { tag: 'delete', build: (rnd) => `cmd /c "type NUL > ${SAFE_PATH(rnd)}"` },
  ],
}

/**
 * Build one round.
 * @param {number} round round number, 1..10.
 * @returns {{lines: {command: string, expect: 'SAFE'|'DANGER', tag: string}[], stats: object}} generated corpus.
 */
export function buildRound(round) {
  const rnd = mulberry32(0x9e3779b9 ^ (round * 2654435761))
  const families = safeFamilies(round)
  if (families.length === 0) throw new Error(`no families for round ${round}`)

  const seen = new Set()
  const lines = []
  const target = LINES_PER_ROUND
  const hazardTarget = Math.floor(target * HAZARD_SHARE)
  const safeTarget = target - hazardTarget

  let guard = 0
  while (lines.length < safeTarget && guard < target * 40) {
    guard += 1
    const family = families[Math.floor(rnd() * families.length)]
    let command
    try {
      command = vary(family(rnd), rnd)
    } catch {
      continue
    }
    if (typeof command !== 'string' || command.length === 0 || command.length > 900) continue
    if (seen.has(command)) continue
    seen.add(command)
    lines.push({ command, expect: 'SAFE', tag: 'read' })
  }

  guard = 0
  const hazardPool = [...HAZARDS, ...(ROUND_HAZARDS[round] ?? [])]
  while (lines.length < target && guard < target * 10) {
    guard += 1
    const hazard = hazardPool[Math.floor(rnd() * hazardPool.length)]
    const command = hazard.build(rnd)
    if (typeof command !== 'string' || command.length === 0) continue
    if (seen.has(command)) continue
    seen.add(command)
    lines.push({ command, expect: 'DANGER', tag: hazard.tag })
  }

  // Shuffle so hazards are not all at the tail.
  for (let i = lines.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = lines[i]
    lines[i] = lines[j]
    lines[j] = tmp
  }

  const digest = createHash('sha256')
    .update(lines.map((l) => l.command).join('\n'))
    .digest('hex')
    .slice(0, 16)

  return {
    lines,
    stats: {
      round,
      total: lines.length,
      safe: lines.filter((l) => l.expect === 'SAFE').length,
      danger: lines.filter((l) => l.expect === 'DANGER').length,
      families: families.length,
      digest,
    },
  }
}

/**
 * Write one round to `corpus/`.
 * @param {number} round round number.
 * @returns {object} round statistics.
 */
export function writeRound(round) {
  const { lines, stats } = buildRound(round)
  mkdirSync(CORPUS, { recursive: true })
  const base = join(CORPUS, `round-${String(round).padStart(2, '0')}`)
  writeFileSync(`${base}.txt`, `${lines.map((l) => l.command).join('\n')}\n`, 'utf8')
  writeFileSync(
    `${base}.labels.tsv`,
    `${lines.map((l, i) => `${i}\t${l.expect}\t${l.tag}`).join('\n')}\n`,
    'utf8',
  )
  writeFileSync(
    `${base}.sample.txt`,
    `${lines
      .filter((_, i) => i % Math.floor(lines.length / 200) === 0)
      .slice(0, 200)
      .map((l) => `${l.expect === 'SAFE' ? '  ' : '!!'} ${l.command}`)
      .join('\n')}\n`,
    'utf8',
  )
  return stats
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('gen-corpus.mjs')) {
  const round = Number(process.argv[2] ?? '1')
  const stats = writeRound(round)
  console.log(JSON.stringify(stats))
}
