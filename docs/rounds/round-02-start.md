# Round 02 — 启动记录

**域 / domain:** 进程、服务、计划任务 · processes, services, scheduled tasks
**命令族 / families:** 17
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (2 × 2654435761)

## 这一轮要问什么

第二轮换域：不再是文件，而是注册项。服务与计划任务都不是文件，回收站永远看不见它们，
所以这一轮专门问一句：插件认不认「非文件删除」。

危险侧新增 `sc.exe delete`、`schtasks /delete`、`Unregister-ScheduledTask`、
`Remove-WmiObject Win32_Service`；安全侧用 `sc query/qc/start`、`Get-Service`、`Get-ScheduledTask`、
`taskkill /F`、`Stop-Process`、`Stop-Service` 压误判。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 2` → `node scripts/run-round.mjs 2`
复盘：见 [round-02-review.md](./round-02-review.md)
