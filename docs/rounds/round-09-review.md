# Round 09 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 生成器第二次撞到熵不足，规则侧 0 漏判

第一版只生成出 59,489 条安全命令：这一域的命令大多不带操作数。修法是把前言池
（`$ErrorActionPreference`、`$ProgressPreference` 等）也纳入变化，安全语料回到 97,000 条。

`device-delete` 与语料同批加入；`Get-PnpDevice`、`Get-Printer`、`pnputil /enum-devices` 保持放行。

## 这一轮对插件做了什么

- 生成器加入前言池（第二轮熵修复）
- 新增 `device-delete`（与语料同批）

## English summary

Second entropy stall (59,489 lines) fixed by prefix variation; device-delete coverage confirmed.
