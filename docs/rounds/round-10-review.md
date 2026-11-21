# Round 10 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 一条「漏判」其实是标签错了

`tar -cf C:\archive.tar -C C:\data .` 被标成危险，但它是**创建**归档，不会删除任何东西。
这条不是插件的洞，是生成器的标签错误：已从危险侧移除。

真正的考点 `truncate` 家族（`Clear-Content`、`Set-Content -Value $null`、`copy NUL`、`type NUL >`）
在同批规则下全部拦住；同时把「删除目带通配」从「非递归放行」改成一律 `unprovable-target`，
因为 `"dir\*"` 这种操作数根本无法核对数量。

## 这一轮对插件做了什么

- 修正 `tar -cf` 的错误标签
- 通配目标一律判 `unprovable-target`
- 新增 `truncate`（与语料同批）

## English summary

One reported miss was a bad label (tar -cf creates an archive). Wildcard operands are now refused outright.
