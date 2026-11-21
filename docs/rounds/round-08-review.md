# Round 08 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 规则先行，本轮 0 漏判

`log-wipe` 与语料同批加入，覆盖 `wevtutil cl|clear-log`、`Clear-EventLog`、`Remove-EventLog`、
以及 `Remove-Item C:\Windows\Logs`。只读的 `Get-WinEvent`、`wevtutil qe`、`wevtutil gl` 保持放行。

同样诚实记一笔：本轮确认覆盖，不是本轮发现。

## 这一轮对插件做了什么

- 新增 `log-wipe`（与语料同批）

## English summary

Confirmation round: log-wipe rules landed with the corpus, and read-only event queries stayed allowed.
