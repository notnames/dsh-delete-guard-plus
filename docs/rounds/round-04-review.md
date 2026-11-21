# Round 04 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 16 条漏判：无回收站存储被当成普通删除

`reg delete … /f`（12 条不同变体）、`Remove-ItemProperty`、`certutil -delstore`、
`secedit /configure /overwrite` 都被放行。其中 `Remove-Item HKLM:\… -Recurse` 虽然被
`shell-delete` 兜住，但理由写成「用 file_trash」是错的 —— 注册表没有回收站。

新增 `registry-delete`（`reg delete`、`Remove-ItemProperty`、`Remove-Item HK*:\`、`secedit /overwrite`）
与 `cert-delete`（`certutil -delstore`、`Remove-Item Cert:\`），并在拒绝理由里指向导出命令。

## 这一轮对插件做了什么

- 新增 `registry-delete`
- 新增 `cert-delete`

## English summary

Sixteen misses across registry, policy and certificate stores — stores that never had a Recycle Bin.
