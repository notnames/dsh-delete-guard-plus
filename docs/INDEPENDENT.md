# 独立验证轮（不用自家语料框架）

十轮语料有一个先天缺陷：**出题人和答题人都是我**。语料模板、危险形态、评分口径
全部出自同一份理解，所以它能证明「规则覆盖了我想到的形态」，不能证明「规则真的看懂了命令」。

这一轮换掉三样东西，只保留被测对象：

| 维度 | 十轮语料 | 这一轮 |
| --- | --- | --- |
| 命令从哪来 | 我写的模板表 | **这台机器自己的 `Get-Command`**：700 个真实 cmdlet、其真实参数名、288 条真实系统路径 |
| 随机源 | mulberry32 | xorshift32（不同生成器、不同种子） |
| 判定依据 | 我写的 ACCEPT 表 | **PowerShell 官方 parser**：`Parser::ParseInput` → `CommandAst`，由语言自己回答「这行到底调用了什么」 |
| 错误分类 | 我预先定义的家族 | 两侧结果互相比对后自然产生的四象限 |

## 怎么跑

```powershell
node test/independent/run.mjs 20000
```

脚本做四件事：

1. `dump-commands.ps1` 调 `Get-Command` 导出真实命令面（缓存为 `surface.json`）；
2. 用 xorshift32 组合出两万行：真实 cmdlet + 真实参数 + 真实路径，另加管道形态与
   `cmd /c "…\"…\""` 引号形态；并保留两段固定人群——真实删除命令打真实系统路径、以及事故同族命令；
3. `oracle.ps1` 在一个 PowerShell 进程里批量解析，输出每行 AST 中的命令名与参数；
4. 与 `inspectCommand` 的判定逐行比对，写出 `corpus/independent-report.json`。

## 结果

```
total                 19,990
oracle delete-like       644    ← AST 里确实调用了删除命令的行
  blocked by guard       644    ← 全部被拦
  missed                   0
unexplained blocks         0    ← 拦了但 AST 认为不是删除的行：没有
incident family          146    ← cmd /c "Remove-Item -Recurse -Force \"<真实系统路径>\""
  blocked                146
quote-damaged lines    3,877    ← 含 \" 的行
  blocked                  0    ← 有意放行（理由见下）
rules fired   protected-target 761 · shell-delete 27 · unprovable-target 1 · log-wipe 1
```

那 3,877 行含 `\"` 却放行的，全部是只读命令（`cmd /c "Format-Hex -Encoding \"C:\Windows\L2Schemas\""`）。
本插件的立场是：**引号写坏本身不是删除风险，写坏的引号里藏着删除才是**。所以判定不是「见到 `\"` 就拒绝」，
而是「见到删除动词 + 引号结构损坏」才拒绝——同一批数据里 146 条带删除的引号行，146 条全拦。

## 这一轮改掉的三个真问题

独立轮还没开始跑，就先撞到插件自己：

1. **把命令名当数据列出会被拒。** 写 `test/independent/oracle.ps1` 时，脚本里有一个
   `@('remove-item', 'clear-recyclebin', …)` 的名称列表用于判断——插件把列表项当成要执行的命令，直接拒绝写入。
   修法：整段文本类规则改为在**剥掉字符串与注释后**的文本上匹配（`stripQuoted`）。
2. **测试文件里写示例命令会被拒。** 修 1 之后，测试文件里作为字符串数据的
   `cmd /c "rmdir /s /q C:\Windows\Temp\x"` 又被嵌套命令扫描命中。
   修法：嵌套命令扫描跳过落在字符串区间内的匹配（`quotedSpans`）。
3. **插件拒绝用户修它自己。** 上面两个修复都发生在插件源码里，而源码里必然出现
   `clear-recyclebin`、`Remove-Item` 这些字面量——于是插件拒绝写入自己的源码，形成死锁（实测卡住两次）。
   修法：写入路径对本插件目录放行。守卫保护的是用户数据，不是它自己。

三处都有回归测试（`test/independent/write-path.mjs`，5 条）。

## 这一轮不能证明什么

- 它只证明「在这台机器的 PowerShell 语义下，AST 认定的删除全部被拦，且没有拦错」；
- AST 是**语法**真相，不是**意图**真相：`Get-ChildItem | Remove-Item` 在 AST 里是两条命令，
  `Remove-Item` 的目标来自管道，语法看不见、运行期才知道——所以插件仍然按「不可证明」拒绝这类写法；
- 它没有覆盖 bash/Git Bash 语义（那一侧只有十轮语料里的 `rm -rf` 家族与单元测试）。
