# Round 03 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 生成器先崩了，然后 6 条漏判

**语料侧：** 第一版只生成出 492 条安全命令。这一域没有操作数可变化，去重之后组合空间只有几百条，
生成器把 400 万次迭代预算烧光。修法：给每行加「自然的尾巴」——`| Select-Object -First N`、
`-ErrorAction`、`Format-Table/List`、`$ProgressPreference` 前言等，纯装饰但合法，组合空间放大到十万级。

**插件侧：** `netsh advfirewall reset`、`netsh winsock reset`、`netsh int ip reset`、
`Remove-NetFirewallRule -All`、`route delete` 全部放行。新增：
- `firewall-reset`：规则全丢，导出前无法恢复；
- `net-reset`：协议栈/路由重置，静态配置无副本。
同时确认 `netsh advfirewall firewall show rule name=all` 仍然放行（只读）。

## 这一轮对插件做了什么

- 生成器加入 `vary()` 组合放大
- 新增 `firewall-reset`
- 新增 `net-reset`

## English summary

Generator stalled at 492 lines until variation was added; six network-configuration deletes were then caught and added.
