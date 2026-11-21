# Round 02 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 26 条漏判：注册项删除完全没被看见

`sc.exe delete EventLog`、`schtasks /delete /tn "…" /f`、`Unregister-ScheduledTask` 全部放行。
原因很直接：规则表里只有文件删除动词，而这些东西是注册表项和 XML 定义。

新增两条规则，并给出恢复路径而不是一句「不行」：
- `service-delete`：`sc delete` / `Remove-Service` / `Remove-WmiObject Win32_Service`；
- `task-delete`：`schtasks /delete` / `Unregister-ScheduledTask`。
拒绝理由里写明先导出（`sc qc`、`schtasks /query /xml`），因为删掉之后没有第二份。

## 这一轮对插件做了什么

- 新增 `service-delete`
- 新增 `task-delete`

## English summary

26 misses: service and scheduled-task deletions are registry/XML records, invisible to a file-delete rule set.
