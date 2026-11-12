# 发布与分发指南

本插件面向 DSH 用户分发，有三条互补的公开渠道：**npm**、**DSH 插件市场索引**、**GitHub Releases / Git commit**。推荐顺序：先推 GitHub → 再发布 npm（可选）→ 更新插件市场索引 → 打个 Release 方便离线安装。

## 0. 版本与发布前检查

1. 确认 `package.json` 的 `version`（当前 `0.2.0`）与代码一致。
2. 确认 `bin/code-trail.exe` 是用目标版本 CodeTrail 构建的（Windows x64；`--version` 应输出 `code-trail x.y.z`）。
3. 跑一遍：

```powershell
node --check index.js; node --check client.js; node --check lib\service.js; node --check lib\http.js; node --check lib\tools.js
npm pack --dry-run
```

4. 在 DSH 中从本地目录安装并冒烟：`plugin_manager install_bundle target=<本目录>` → 调一次 `code_trail_scan` → 面板能打开 view。

## 1. GitHub 仓库（一切的基础）

```powershell
git add -A
git commit -m "Release codetrail-dsh 0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

记下这次提交的 40 位 SHA（市场索引的 `source.commit` 要用它）：

```powershell
git rev-parse HEAD
```

## 2. npm（公开安装入口，可选但推荐）

前提：npm 账号（`npm login`），包名 `codetrail-dsh` 未被占用（当前可用；若被占用改用你拥有的 scope，例如 `@wwwh7/codetrail-dsh`，同时改 `package.json`、`cordis.patch.yml` 与 `client.js` 中的 bundle 名）。

```powershell
npm pack                      # 生成 codetrail-dsh-0.2.0.tgz，检查内容
npm publish                   # 公开包；package.json 已声明 publishConfig.access=public
```

发布后验证：

```powershell
npm view codetrail-dsh version
```

用户安装：`plugin_manager install_bundle target = codetrail-dsh@0.2.0`。

每次发版注意：先重建并提交 `bin/code-trail.exe` 再 `npm publish`，否则包里的二进制与声明版本不一致。

## 3. DSH 插件市场索引

仓库根目录的 [plugin-market.json](plugin-market.json) 是 DSH 的格式 1 索引。用户把它的 HTTPS 地址加入 DSH 设置 → Plugins（Discover 的“添加索引”），即可浏览和安装。

索引 URL（stable raw 地址）：

```text
https://raw.githubusercontent.com/wwwh7-cypher/codetrail-dsh/main/plugin-market.json
```

每次发版更新索引：

- `plugins[].versions[]` 追加新版本；
- `publishTimestamp` 用 Unix 秒；
- `source.commit` 填**包含该版本插件文件**的 40 位 SHA（不是 tag）；
- 删除不再提供的旧版本，或保留用于回滚；
- 提交并推送后再验证 raw URL 返回新 JSON（GitHub raw 有短暂缓存）。

索引格式要点（由 `@deepseek-ai/dsh-plugin-market-index` 校验）：

- 顶层 `{ format: 1, title: {en,...}, description?, metadata?, plugins: [...] }`；
- 每个插件：`name`（npm 包名）、`title`/`description`（本地化对象，至少 `en`）、`icon`（相对索引 URL 的 https 路径或 data URL）、`author`、`homepage`、`repository`、`metadata.category/labels`、`versions`；
- 每个版本：`version`（精确 SemVer）、`publishTimestamp`（Unix 秒整数）、`source`（`{type:"git", url, commit, path?}` 或 `{type:"npm", registry?}`）、`engines.dsh?`（SemVer range，可省略）；
- `source.path` 是包目录相对仓库根；本仓库包在根目录，省略。

## 4. GitHub Releases（离线安装）

在 GitHub 仓库 → Releases → Draft a new release，选择 tag `v0.2.0`，上传：

- `codetrail-dsh-0.2.0.tgz`（`npm pack` 产物）；
- 可选：`SHA256SUMS`。

用户下载、解压后把目录交给 `plugin_manager install_bundle`，或直接 `npm install -g ./codetrail-dsh-0.2.0.tgz` 不适用（DSH 用 pnpm profile 安装，用 `install_bundle` 指向解压目录即可）。

## 5. 可选：GitHub Pages / 自定义域名

raw.githubusercontent.com 已可直接作为索引地址。若想要更稳定的域名或统计，可启用 GitHub Pages 托管同一份 `plugin-market.json`，索引里相对图标会自动解析到 Pages 域名；记得同步更新 README 与索引地址。

## 6. 版本兼容与回滚

- 插件自带 `engines.dsh` 可声明兼容范围；未声明时 DSH 只做基本安装检查。升级 DSH 后若 `install_bundle` 报兼容性错误，在索引/包中补 `engines.dsh` 或发布新版本。
- 回滚：在市场索引中把旧版本重新列为默认（版本排序决定默认版本，SemVer 优先级最高者为默认；旧版本保留在 `versions` 即可手动选择）。
- 收到安全问题时优先发布新版本并在 README/Release 中说明；不要静默替换已发布版本的二进制。

## 7. 仓库建议设置

- About：description + topics：`deepseek-harness`, `dsh`, `dsh-plugin`, `code-trail`, `call-graph`, `static-analysis`。
- 保护 `main`：要求 PR/至少一次 review（单人仓库可跳过）。
- Release 附件保持 tgz 与源码一致；LICENSE 保持 AGPL-3.0（上游 CodeTrail 为 MIT，README 已注明）。
