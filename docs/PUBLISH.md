# 发布与发现 / Publishing and discovery

仓库已经建好并推送：<https://github.com/notnames/dsh-delete-guard-plus>
（分支 `main`，topics 已打：`dsh-plugin`、`dsh`、`deepseek-harness`、`cordis`、`guard`、`recycle-bin`、`windows`、`powershell`、`safety`）

这台机器上**没有 npm 登录凭据**（`~/.npmrc` 只有 cache，`npm whoami` 返回 `ENEEDAUTH`），
所以下面第 2 步需要你用自己的 npm 账号执行一次。除此之外都已经就绪。

## 1. 从 GitHub 直接安装（现在就能用）

```powershell
dsh plugin --profile <profile> add github:notnames/dsh-delete-guard-plus
# 或本地开发：
node "<pnpm.cjs>" add "link:C:/path/to/dsh-delete-guard-plus" --dir "$env:USERPROFILE\.dsh\profiles\<profile>"
```

然后把 bundle 加进 profile 的 `package.json`：

```json
"dsh": { "profile": { "bundles": [ "...", "dsh-delete-guard-plus" ] } }
```

## 2. 发布到 npm（社区索引的来源）

```powershell
npm login                      # 浏览器登录；确认 npm whoami 输出 notnames
cd <repo>
npm publish --access public
```

发布后验证：

```powershell
npm view dsh-delete-guard-plus version
npm view dsh-delete-guard-plus keywords
dsh plugin --profile <profile> add dsh-delete-guard-plus
```

`package.json` 里已经写好上线所需的一切：

- `name` / `version` / `description`（含 `Merges dsh-delete-guard`，便于搜索命中）
- `keywords` 含 `dsh-plugin`、`deepseek-harness`、`recycle-bin`、`quoting`、`rmdir`
- `os: ["win32"]`、`engines.node >= 20`
- `dsh.bundle.patch` 指向 `cordis.patch.yml`
- `files` 白名单：`lib`、`scripts/recycle-bin.ps1`、`cordis.patch.yml`、两份 README、
  CHANGELOG、NOTICE、LICENSE、`docs/assets`、`docs/rounds`（34 个文件，306 KB）

## 3. 被插件市场看到

DSH 的插件市场/索引按 npm 包及其关键字抓取，所以 **第 2 步做完即进入可检索范围**。
想让搜索命中更稳，可以再确认一次关键字（已包含）：

```powershell
npm view dsh-delete-guard-plus keywords
```

如果市场提供人工提交入口（如 dshmarket 的社区列表），提交时用：

| 字段 | 值 |
| --- | --- |
| name | `dsh-delete-guard-plus` |
| repo | `https://github.com/notnames/dsh-delete-guard-plus` |
| 一句话 | 把每一次删除都逼进回收站，并拦住把路径变成卷根的引号错误 |
| 平台 | Windows（`win32`） |
| 许可证 | MIT |

## 4. 自动化：打 tag 即发布（可选）

`.github/workflows/publish.yml` 已备好，使用 npm Trusted Publishing（OIDC），不需要把 token 存进仓库：

1. npm 包页 → Settings → Trusted Publisher → 选 GitHub Actions：
   organization/user `notnames`，repository `dsh-delete-guard-plus`，workflow `publish.yml`；
2. 之后 `git tag v2.0.0 && git push origin v2.0.0` 就会自动发布。

## 5. 版本约定

- 规则新增（新的删除族）→ `minor`
- 仅修误判/漏判 → `patch`
- 判定语义变更（例如默认改为允许安全删除）→ `major`，并在 CHANGELOG 写明迁移
