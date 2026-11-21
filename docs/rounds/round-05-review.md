# Round 05 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 4 条漏判，其中包括删快照

`vssadmin delete shadows /all /quiet`、`Format-Volume`、`Remove-Partition`、`Initialize-Disk` 放行。
其中删快照尤其讽刺：快照是这台机器自己的「撤销键」，删掉它等于把**已经丢失的文件**的最后一扇门关上。

新增 `shadow-delete` 与 `disk-destructive`；拒绝理由里明确「这摧毁的是索引，不是文件，恢复需要离线工具」。

## 这一轮对插件做了什么

- 新增 `shadow-delete`
- 新增 `disk-destructive`

## English summary

Four misses, including shadow-copy deletion — the one operation that removes the machine's own undo.
