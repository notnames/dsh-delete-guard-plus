# Round 01 — 启动记录

**域 / domain:** 文件系统 · filesystem traversal, copy, move, metadata
**命令族 / families:** 20
**规模 / size:** 100,000 行（97,000 安全 + 3,000 危险变异）
**独立种子 / seed:** 0x9e3779b9 ^ (1 × 2654435761)

## 这一轮要问什么

第一轮的语料只做一件事：证明读起来完全正常的文件系统命令不会被拦。
20 个命令族，覆盖 `Get-ChildItem`、`Copy-Item`、`Move-Item`、`robocopy /E`、`xcopy`、`icacls`、
`tree`、`dir /S`、`where /R`、`Get-FileHash`、`Add-Content` 等；3% 的行由危险变异体构成
（卷根、裸分隔符、变量目标、`robocopy /MIR`、引号塌缩）。

预期考点：PowerShell 的 `-Format` 参数会不会被误判成擦除工具；cmd 方言下的引号解析是否成立。

## 判据

- 安全命令被拦 = **误判**（说明规则太宽，会让人关掉插件）
- 危险命令放行 = **漏判**（说明有洞）
- 拦住了但规则名不对 = **口径不对**（说明判据或标签要修）

## 结果入口

运行：`node scripts/gen-corpus.mjs 1` → `node scripts/run-round.mjs 1`
复盘：见 [round-01-review.md](./round-01-review.md)
