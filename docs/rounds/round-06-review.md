# Round 06 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 8 条漏判：删账户、删组成员、剥 ACL

`net user <name> /delete`（多条变体）、`Remove-LocalGroupMember`、`icacls … /remove:g … /T /C` 全部放行。
`Remove-LocalUser` 也没有对应规则，只是恰好被别的规则挡住过。

新增 `identity-delete`（`net user /delete`、`net localgroup /delete`、`Remove-LocalUser/-ADUser`、
`Remove-LocalGroupMember/-ADGroupMember`）与 `acl-strip`（`icacls /remove`、`/reset`）。

## 这一轮对插件做了什么

- 新增 `identity-delete`
- 新增 `acl-strip`

## English summary

Eight misses: account deletion, group-membership removal and ACL stripping all passed as ordinary commands.
