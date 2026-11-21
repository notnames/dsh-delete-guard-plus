# Round 03 — 启动记录

**域 / domain:** 网络 · adapters, name resolution, firewall, routes
**命令族 / families:** 18
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (3 × 2654435761)

## 这一轮要问什么

第三轮考网络。这一域的特点是：大量只读命令**不接操作数**（`ipconfig /all`、`arp -a`、`route print -4`），
正好用来压一压「误报」这一侧。危险侧放的是防火墙与协议栈重置 —— 它们是配置删除，不是文件删除。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 3` → `node scripts/run-round.mjs 3`
复盘：见 [round-03-review.md](./round-03-review.md)
