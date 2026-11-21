# Round 05 — 启动记录

**域 / domain:** 磁盘、卷、快照 · disks, volumes, shadow copies
**命令族 / families:** 14
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (5 × 2654435761)

## 这一轮要问什么

第五轮问的是最接近那次事故的场景：卷与分区几何。
`Clear-Disk`、`Format-Volume`、`Remove-Partition`、`Initialize-Disk`、`vssadmin delete shadows`
——没有一条会进回收站，因为它们动的是文件系统索引本身。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 5` → `node scripts/run-round.mjs 5`
复盘：见 [round-05-review.md](./round-05-review.md)
