# Round 01 — 复盘

**规模:** 100000 行　**误判:** 0　**漏判:** 0　**口径:** 0

## 断了两处，都是真 bug

**1. `-Format` 被当成 `format`。** 9,609 行误判：`Add-Content -Value (Get-Date -Format o)`、
`Get-FileHash … | Format-List` 全部被 `wipe-tool` 拒绝。原因是擦除工具用整段文本做 `\bformat\b` 匹配，
而 `Format-List` 里的 `Format` 正好命中词边界。修法：擦除工具只在**命令位**判定（语句首个 token，
或 `{`、`(`、`&`、`;` 之后的 token），参数里的 `-Format` 不再是命令。

**2. cmd 方言里把 `\` 当转义符。** `rd /s /q "\"` 本该解析出根路径 `\`，却因为消费了下一个字符，
把闭合引号一起吃掉了 —— 结果报「引号不配对」，而不是「目标是卷根」。修法：只有 bash 让 `\` 具有转义作用，
cmd 用 `^`，PowerShell 用反引号；tokenizer 按方言分支。

**3. 标签口径。** 2,072 条「规则不匹配」里大部分不是插件错，而是我把 `%SystemDrive%`、`~`、UNC 都标成了
`root`。它们在运行期确实是卷根，判成 `unprovable-target`/`unc-target` 才是诚实的。修的是评分口径，不是规则。

**4. `Move-Item` 不算删除。** 它曾经被误列进删除动词，导致移动文件被拦；已剔除。

## 这一轮对插件做了什么

- 擦除工具改为命令位判定（wipe-tool 不再命中 `-Format`）
- tokenizer 按方言区分反斜杠语义（bash 转义 / cmd 字面 / pwsh 反引号）
- `Move-Item` 移出删除动词表
- 评分口径：`root` 家族接受 `unprovable-target`、`unc-target`

## English summary

Two real defects found: `-Format` matched the wipe rule, and the cmd tokenizer treated `\` as an escape, swallowing closing quotes.
