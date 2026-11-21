# Round 07 — 启动记录

**域 / domain:** 包管理与工具链 · git, npm, dotnet, winget
**命令族 / families:** 17
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (7 × 2654435761)

## 这一轮要问什么

第七轮是开发者的日常：`git clean -fdx`、`git reset --hard`、`git branch -D`、`git stash clear`、
`git checkout -- .`。这些命令不删文件名，删的是「还没提交的工作」。

有意把 `winget uninstall`、`npm cache clean`、`dotnet nuget locals --clear` 移出危险侧：
包卸载与缓存清理是用户明确要求的常规操作，把它们拦下来只会让人关掉插件。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 7` → `node scripts/run-round.mjs 7`
复盘：见 [round-07-review.md](./round-07-review.md)
