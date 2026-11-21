# Round 10 — 启动记录

**域 / domain:** 文本、编码、压缩 · text pipeline, encoding, archives
**命令族 / families:** 15
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (10 × 2654435761)

## 这一轮要问什么

第十轮是最隐蔽的一类：文件还在，内容没了。
`Clear-Content`、`Set-Content -Value $null`、`copy NUL`、`type NUL >`、`Remove-Item "dir\*"`
——文件的时间戳和大小可能都还是「像样」的，但字节已经清空。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 10` → `node scripts/run-round.mjs 10`
复盘：见 [round-10-review.md](./round-10-review.md)
