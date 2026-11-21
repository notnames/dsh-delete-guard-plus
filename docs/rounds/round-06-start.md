# Round 06 — 启动记录

**域 / domain:** 账户、身份、ACL · accounts, identity, access control
**命令族 / families:** 14
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (6 × 2654435761)

## 这一轮要问什么

第六轮换到「人」这一侧：账户、组成员、ACL。
账户被删除时，profile 路径、SID 映射、组成员关系一起消失；ACL 被清空时文件还在，但保护它们的东西没了。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 6` → `node scripts/run-round.mjs 6`
复盘：见 [round-06-review.md](./round-06-review.md)
