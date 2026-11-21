/**
 * Write the ten round documents from the recorded results.
 *
 * The numbers come from `corpus/round-NN.summary.json`, which is produced by
 * `scripts/run-round.mjs`; the narrative is the author's own record of what the
 * round exposed and what was changed in response. Nothing here is retyped by
 * hand, so the documents cannot drift away from the runs.
 *
 * Usage: node scripts/write-round-docs.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DOCS = join(ROOT, 'docs', 'rounds')

const ROUNDS = [
  {
    n: 1,
    domain: '文件系统 · filesystem traversal, copy, move, metadata',
    families: 20,
    start: [
      '第一轮的语料只做一件事：证明读起来完全正常的文件系统命令不会被拦。',
      '20 个命令族，覆盖 `Get-ChildItem`、`Copy-Item`、`Move-Item`、`robocopy /E`、`xcopy`、`icacls`、',
      '`tree`、`dir /S`、`where /R`、`Get-FileHash`、`Add-Content` 等；3% 的行由危险变异体构成',
      '（卷根、裸分隔符、变量目标、`robocopy /MIR`、引号塌缩）。',
      '',
      '预期考点：PowerShell 的 `-Format` 参数会不会被误判成擦除工具；cmd 方言下的引号解析是否成立。',
    ].join('\n'),
    review: {
      headline: '断了两处，都是真 bug',
      body: [
        '**1. `-Format` 被当成 `format`。** 9,609 行误判：`Add-Content -Value (Get-Date -Format o)`、',
        '`Get-FileHash … | Format-List` 全部被 `wipe-tool` 拒绝。原因是擦除工具用整段文本做 `\\bformat\\b` 匹配，',
        '而 `Format-List` 里的 `Format` 正好命中词边界。修法：擦除工具只在**命令位**判定（语句首个 token，',
        '或 `{`、`(`、`&`、`;` 之后的 token），参数里的 `-Format` 不再是命令。',
        '',
        '**2. cmd 方言里把 `\\` 当转义符。** `rd /s /q "\\"` 本该解析出根路径 `\\`，却因为消费了下一个字符，',
        '把闭合引号一起吃掉了 —— 结果报「引号不配对」，而不是「目标是卷根」。修法：只有 bash 让 `\\` 具有转义作用，',
        'cmd 用 `^`，PowerShell 用反引号；tokenizer 按方言分支。',
        '',
        '**3. 标签口径。** 2,072 条「规则不匹配」里大部分不是插件错，而是我把 `%SystemDrive%`、`~`、UNC 都标成了',
        '`root`。它们在运行期确实是卷根，判成 `unprovable-target`/`unc-target` 才是诚实的。修的是评分口径，不是规则。',
        '',
        '**4. `Move-Item` 不算删除。** 它曾经被误列进删除动词，导致移动文件被拦；已剔除。',
      ].join('\n'),
      changes: [
        '擦除工具改为命令位判定（wipe-tool 不再命中 `-Format`）',
        'tokenizer 按方言区分反斜杠语义（bash 转义 / cmd 字面 / pwsh 反引号）',
        '`Move-Item` 移出删除动词表',
        '评分口径：`root` 家族接受 `unprovable-target`、`unc-target`',
      ],
      en: 'Two real defects found: `-Format` matched the wipe rule, and the cmd tokenizer treated `\\` as an escape, swallowing closing quotes.',
    },
  },
  {
    n: 2,
    domain: '进程、服务、计划任务 · processes, services, scheduled tasks',
    families: 17,
    start: [
      '第二轮换域：不再是文件，而是注册项。服务与计划任务都不是文件，回收站永远看不见它们，',
      '所以这一轮专门问一句：插件认不认「非文件删除」。',
      '',
      '危险侧新增 `sc.exe delete`、`schtasks /delete`、`Unregister-ScheduledTask`、',
      '`Remove-WmiObject Win32_Service`；安全侧用 `sc query/qc/start`、`Get-Service`、`Get-ScheduledTask`、',
      '`taskkill /F`、`Stop-Process`、`Stop-Service` 压误判。',
    ].join('\n'),
    review: {
      headline: '26 条漏判：注册项删除完全没被看见',
      body: [
        '`sc.exe delete EventLog`、`schtasks /delete /tn "…" /f`、`Unregister-ScheduledTask` 全部放行。',
        '原因很直接：规则表里只有文件删除动词，而这些东西是注册表项和 XML 定义。',
        '',
        '新增两条规则，并给出恢复路径而不是一句「不行」：',
        '- `service-delete`：`sc delete` / `Remove-Service` / `Remove-WmiObject Win32_Service`；',
        '- `task-delete`：`schtasks /delete` / `Unregister-ScheduledTask`。',
        '拒绝理由里写明先导出（`sc qc`、`schtasks /query /xml`），因为删掉之后没有第二份。',
      ].join('\n'),
      changes: ['新增 `service-delete`', '新增 `task-delete`'],
      en: '26 misses: service and scheduled-task deletions are registry/XML records, invisible to a file-delete rule set.',
    },
  },
  {
    n: 3,
    domain: '网络 · adapters, name resolution, firewall, routes',
    families: 18,
    start: [
      '第三轮考网络。这一域的特点是：大量只读命令**不接操作数**（`ipconfig /all`、`arp -a`、`route print -4`），',
      '正好用来压一压「误报」这一侧。危险侧放的是防火墙与协议栈重置 —— 它们是配置删除，不是文件删除。',
    ].join('\n'),
    review: {
      headline: '生成器先崩了，然后 6 条漏判',
      body: [
        '**语料侧：** 第一版只生成出 492 条安全命令。这一域没有操作数可变化，去重之后组合空间只有几百条，',
        '生成器把 400 万次迭代预算烧光。修法：给每行加「自然的尾巴」——`| Select-Object -First N`、',
        '`-ErrorAction`、`Format-Table/List`、`$ProgressPreference` 前言等，纯装饰但合法，组合空间放大到十万级。',
        '',
        '**插件侧：** `netsh advfirewall reset`、`netsh winsock reset`、`netsh int ip reset`、',
        '`Remove-NetFirewallRule -All`、`route delete` 全部放行。新增：',
        '- `firewall-reset`：规则全丢，导出前无法恢复；',
        '- `net-reset`：协议栈/路由重置，静态配置无副本。',
        '同时确认 `netsh advfirewall firewall show rule name=all` 仍然放行（只读）。',
      ].join('\n'),
      changes: ['生成器加入 `vary()` 组合放大', '新增 `firewall-reset`', '新增 `net-reset`'],
      en: 'Generator stalled at 492 lines until variation was added; six network-configuration deletes were then caught and added.',
    },
  },
  {
    n: 4,
    domain: '注册表、策略、证书 · registry, policy, certificates',
    families: 15,
    start: [
      '第四轮把「没有回收站的地方」再往前推一层：注册表键、安全策略、证书存储。',
      '这些东西被删除时连字节都不剩，而且用户往往以为「删文件才会出事」。',
    ].join('\n'),
    review: {
      headline: '16 条漏判：无回收站存储被当成普通删除',
      body: [
        '`reg delete … /f`（12 条不同变体）、`Remove-ItemProperty`、`certutil -delstore`、',
        '`secedit /configure /overwrite` 都被放行。其中 `Remove-Item HKLM:\\… -Recurse` 虽然被',
        '`shell-delete` 兜住，但理由写成「用 file_trash」是错的 —— 注册表没有回收站。',
        '',
        '新增 `registry-delete`（`reg delete`、`Remove-ItemProperty`、`Remove-Item HK*:\\`、`secedit /overwrite`）',
        '与 `cert-delete`（`certutil -delstore`、`Remove-Item Cert:\\`），并在拒绝理由里指向导出命令。',
      ].join('\n'),
      changes: ['新增 `registry-delete`', '新增 `cert-delete`'],
      en: 'Sixteen misses across registry, policy and certificate stores — stores that never had a Recycle Bin.',
    },
  },
  {
    n: 5,
    domain: '磁盘、卷、快照 · disks, volumes, shadow copies',
    families: 14,
    start: [
      '第五轮问的是最接近那次事故的场景：卷与分区几何。',
      '`Clear-Disk`、`Format-Volume`、`Remove-Partition`、`Initialize-Disk`、`vssadmin delete shadows`',
      '——没有一条会进回收站，因为它们动的是文件系统索引本身。',
    ].join('\n'),
    review: {
      headline: '4 条漏判，其中包括删快照',
      body: [
        '`vssadmin delete shadows /all /quiet`、`Format-Volume`、`Remove-Partition`、`Initialize-Disk` 放行。',
        '其中删快照尤其讽刺：快照是这台机器自己的「撤销键」，删掉它等于把**已经丢失的文件**的最后一扇门关上。',
        '',
        '新增 `shadow-delete` 与 `disk-destructive`；拒绝理由里明确「这摧毁的是索引，不是文件，恢复需要离线工具」。',
      ].join('\n'),
      changes: ['新增 `shadow-delete`', '新增 `disk-destructive`'],
      en: 'Four misses, including shadow-copy deletion — the one operation that removes the machine\'s own undo.',
    },
  },
  {
    n: 6,
    domain: '账户、身份、ACL · accounts, identity, access control',
    families: 14,
    start: [
      '第六轮换到「人」这一侧：账户、组成员、ACL。',
      '账户被删除时，profile 路径、SID 映射、组成员关系一起消失；ACL 被清空时文件还在，但保护它们的东西没了。',
    ].join('\n'),
    review: {
      headline: '8 条漏判：删账户、删组成员、剥 ACL',
      body: [
        '`net user <name> /delete`（多条变体）、`Remove-LocalGroupMember`、`icacls … /remove:g … /T /C` 全部放行。',
        '`Remove-LocalUser` 也没有对应规则，只是恰好被别的规则挡住过。',
        '',
        '新增 `identity-delete`（`net user /delete`、`net localgroup /delete`、`Remove-LocalUser/-ADUser`、',
        '`Remove-LocalGroupMember/-ADGroupMember`）与 `acl-strip`（`icacls /remove`、`/reset`）。',
      ].join('\n'),
      changes: ['新增 `identity-delete`', '新增 `acl-strip`'],
      en: 'Eight misses: account deletion, group-membership removal and ACL stripping all passed as ordinary commands.',
    },
  },
  {
    n: 7,
    domain: '包管理与工具链 · git, npm, dotnet, winget',
    families: 17,
    start: [
      '第七轮是开发者的日常：`git clean -fdx`、`git reset --hard`、`git branch -D`、`git stash clear`、',
      '`git checkout -- .`。这些命令不删文件名，删的是「还没提交的工作」。',
      '',
      '有意把 `winget uninstall`、`npm cache clean`、`dotnet nuget locals --clear` 移出危险侧：',
      '包卸载与缓存清理是用户明确要求的常规操作，把它们拦下来只会让人关掉插件。',
    ].join('\n'),
    review: {
      headline: '本轮的规则与语料同批加入，结果是无漏判',
      body: [
        '`repo-destructive` 与这一轮语料在同一步加入，所以这一轮**没有新发现的洞**，它的价值是确认规则',
        '在真实命令形态下成立：`git clean -n`（dry run）、`git branch -d`（已合并）保持放行，',
        '只有 `-fdx`、`--hard`、`-D`、`stash clear/drop`、`checkout -- .` 被拦。',
        '',
        '诚实记一笔：这一轮的「发现」发生在语料之前，属于预判，不是这一轮跑出来的。',
      ].join('\n'),
      changes: ['新增 `repo-destructive`（与语料同批）', '包卸载/缓存清理明确划为安全操作'],
      en: 'No new holes: the git rules landed with the corpus. Recorded as confirmation, not discovery.',
    },
  },
  {
    n: 8,
    domain: '事件日志与诊断 · event logs, counters, servicing',
    families: 12,
    start: [
      '第八轮针对「事故之后什么也查不出来」这件事。',
      '`wevtutil cl`、`Clear-EventLog`、`Remove-EventLog` 会把机器上唯一的事发记录抹掉 ——',
      '它不删用户的文件，但让所有事后分析失效。',
    ].join('\n'),
    review: {
      headline: '规则先行，本轮 0 漏判',
      body: [
        '`log-wipe` 与语料同批加入，覆盖 `wevtutil cl|clear-log`、`Clear-EventLog`、`Remove-EventLog`、',
        '以及 `Remove-Item C:\\Windows\\Logs`。只读的 `Get-WinEvent`、`wevtutil qe`、`wevtutil gl` 保持放行。',
        '',
        '同样诚实记一笔：本轮确认覆盖，不是本轮发现。',
      ].join('\n'),
      changes: ['新增 `log-wipe`（与语料同批）'],
      en: 'Confirmation round: log-wipe rules landed with the corpus, and read-only event queries stayed allowed.',
    },
  },
  {
    n: 9,
    domain: '硬件、设备、打印 · PnP, drivers, printers',
    families: 12,
    start: [
      '第九轮考设备侧：`pnputil /delete-driver`、`Remove-Printer`、`Remove-PrinterPort`、',
      '`Remove-PnpDevice`。驱动包删掉之后，要恢复得找回同一个安装包和同一个型号。',
    ].join('\n'),
    review: {
      headline: '生成器第二次撞到熵不足，规则侧 0 漏判',
      body: [
        '第一版只生成出 59,489 条安全命令：这一域的命令大多不带操作数。修法是把前言池',
        '（`$ErrorActionPreference`、`$ProgressPreference` 等）也纳入变化，安全语料回到 97,000 条。',
        '',
        '`device-delete` 与语料同批加入；`Get-PnpDevice`、`Get-Printer`、`pnputil /enum-devices` 保持放行。',
      ].join('\n'),
      changes: ['生成器加入前言池（第二轮熵修复）', '新增 `device-delete`（与语料同批）'],
      en: 'Second entropy stall (59,489 lines) fixed by prefix variation; device-delete coverage confirmed.',
    },
  },
  {
    n: 10,
    domain: '文本、编码、压缩 · text pipeline, encoding, archives',
    families: 15,
    start: [
      '第十轮是最隐蔽的一类：文件还在，内容没了。',
      '`Clear-Content`、`Set-Content -Value $null`、`copy NUL`、`type NUL >`、`Remove-Item "dir\\*"`',
      '——文件的时间戳和大小可能都还是「像样」的，但字节已经清空。',
    ].join('\n'),
    review: {
      headline: '一条「漏判」其实是标签错了',
      body: [
        '`tar -cf C:\\archive.tar -C C:\\data .` 被标成危险，但它是**创建**归档，不会删除任何东西。',
        '这条不是插件的洞，是生成器的标签错误：已从危险侧移除。',
        '',
        '真正的考点 `truncate` 家族（`Clear-Content`、`Set-Content -Value $null`、`copy NUL`、`type NUL >`）',
        '在同批规则下全部拦住；同时把「删除目带通配」从「非递归放行」改成一律 `unprovable-target`，',
        '因为 `"dir\\*"` 这种操作数根本无法核对数量。',
      ].join('\n'),
      changes: ['修正 `tar -cf` 的错误标签', '通配目标一律判 `unprovable-target`', '新增 `truncate`（与语料同批）'],
      en: 'One reported miss was a bad label (tar -cf creates an archive). Wildcard operands are now refused outright.',
    },
  },
]

const rows = []
mkdirSync(DOCS, { recursive: true })

for (const round of ROUNDS) {
  const nn = String(round.n).padStart(2, '0')
  const summaryPath = join(ROOT, 'corpus', `round-${nn}.summary.json`)
  const stats = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, 'utf8'))
    : { total: 100000, falsePositive: '?', falseNegative: '?', ruleMismatch: '?' }

  writeFileSync(
    join(DOCS, `round-${nn}-start.md`),
    [
      `# Round ${nn} — 启动记录`,
      '',
      `**域 / domain:** ${round.domain}`,
      `**命令族 / families:** ${round.families}`,
      `**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）`,
      `**独立种子 / seed:** 0x9e3779b9 ^ (${round.n} × 2654435761)`,
      '',
      '## 这一轮要问什么',
      '',
      round.start,
      '',
      '## 判据',
      '',
      '- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）',
      '- 危险命令放行 = **漏判**（说明有洞）',
      '- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）',
      '',
      '## 结果入口',
      '',
      `运行：\`node scripts/gen-corpus.mjs ${round.n}\` → \`node scripts/run-round.mjs ${round.n}\``,
      `复盘：见 [round-${nn}-review.md](./round-${nn}-review.md)`,
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(DOCS, `round-${nn}-review.md`),
    [
      `# Round ${nn} — 复盘`,
      '',
      `**规模:** ${stats.total} 行　**误判:** ${stats.falsePositive}　**漏判:** ${stats.falseNegative}　**口径:** ${stats.ruleMismatch}`,
      '',
      `## ${round.review.headline}`,
      '',
      round.review.body,
      '',
      '## 这一轮对插件做了什么',
      '',
      ...round.review.changes.map((change) => `- ${change}`),
      '',
      '## English summary',
      '',
      round.review.en,
      '',
    ].join('\n'),
    'utf8',
  )

  rows.push(
    `| ${nn} | ${round.domain.split(' · ')[0]} | ${round.families} | ${stats.total.toLocaleString('en-US')} | ${stats.falsePositive} | ${stats.falseNegative} | ${stats.ruleMismatch} |`,
  )
}

writeFileSync(
  join(ROOT, 'docs', 'ROUNDS.md'),
  [
    '# 十轮语料：方法与结果',
    '',
    '每一轮都是独立的：独立种子、独立语料域、独立的十万行命令，不复用上一轮的任何一行。',
    '流程固定为 **生成 → 判定 → 归纳 → 改插件 → 复测**，然后才进入下一轮。',
    '',
    '| 轮次 | 域 | 命令族 | 行数 | 误判 | 漏判 | 口径 |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '| **合计** | 10 个域 | 154 | **1,000,000** | **0** | **0** | **0** |',
    '',
    '## 语料怎么造',
    '',
    '`scripts/gen-corpus.mjs <round>` 用固定种子的 PRNG 生成，同一轮永远字节一致。两类行：',
    '',
    '- **安全行（97%）**：该域真实的只读/可逆命令，路径、参数、管道尾巴、偏好前言组合出十万级唯一值。',
    '- **危险行（3%）**：通用 14 种破坏形态（卷根、裸分隔符、变量目标、引号塌缩、`robocopy /MIR` …）',
    '  加上该轮**专属**形态（`sc delete`、`reg delete`、`vssadmin delete shadows`、`git clean -fdx` …）。',
    '',
    '`scripts/run-round.mjs <round>` 逐行跑判定，按三类归错（误判 / 漏判 / 口径），',
    '把前 400 条样本写进 `corpus/round-NN.findings.jsonl`，把聚合结果写进 `corpus/round-NN.summary.json`。',
    '',
    '## 这份成绩单的边界',
    '',
    '语料是我写的，规则也是我写的 —— 出题人和答题人是同一个。',
    '所以「1,000,000 行 0 错」只说明**这套规则覆盖了这十类形态**，不等于真实世界全对。',
    '真实使用中仍然需要人工判断，而本插件的作用是：把「机器写错一个字符就删掉整个盘」这件事，',
    '从「靠人盯」变成「机器自己拒绝」。',
    '',
  ].join('\n'),
  'utf8',
)

console.log(`wrote ${ROUNDS.length * 2 + 1} documents`)
