# codetrail-dsh

把 [CodeTrail](https://github.com/wwwh7-cypher/CodeTrail)（Rust 静态调用图 + 自包含 HTML 工作台）打包成可安装的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件 bundle。一个 bundle 同时提供 Host 工具与 Web 面板：

- **Host 工具**：`code_trail_scan`、`code_trail_query`、`code_trail_review`、`code_trail_memory`。Agent 在对话里直接调用，输出 JSON / 文本证据；`code_trail_query` 的 `modules` 返回模块统计、跨模块调用点、instability 与循环依赖摘要。
- **Web 面板**：左侧栏出现「CodeTrail 架构导览」图标，中央面板列出最近 40 条扫描 / 审查记录，并用 iframe 加载 Rust 生成的自包含工作台。工作台支持 `×N` 调用点聚合、静态/候选解析虚线、`⚡N` 未解析角标与原因、方向开关与上下游深度、Top-N 扇出聚合、紧凑卡/LOD、关系清单三表、图派生范围筛选、模块指标/全量依赖表/循环高亮、入口分类与距入口跳数、review 模块级变更摘要。

分析全部在本机完成：Rust 分析器只读源码，插件只写 `<DSH_HOME>/codetrail/`；不联网、不调用模型。

## 安装

要求：DSH Web profile（插件注入 `tools` 与 `webServer` 两个 Host 服务）；内置二进制为 **Windows x64**。

### 方式 1：插件市场（推荐给普通用户）

在 DSH 设置 → Plugins / Discover 中添加本仓库的插件索引：

```text
https://raw.githubusercontent.com/wwwh7-cypher/codetrail-dsh/main/plugin-market.json
```

然后在 Discover 中搜索 **CodeTrail** 安装。索引内容见仓库根目录 [plugin-market.json](plugin-market.json)。

### 方式 2：npm

```text
plugin_manager install_bundle  target = codetrail-dsh@0.2.0
```

（npm 包发布后可用；发布步骤见 [PUBLISHING.md](PUBLISHING.md)。）

### 方式 3：Git commit（可复现，市场索引也用这种方式）

```text
plugin_manager install_bundle  target = git+https://github.com/wwwh7-cypher/codetrail-dsh.git#<commit-sha>
```

commit 必须是本仓库包含插件文件的那个 40 位 SHA；市场索引里的 `source.commit` 就是它。

### 方式 4：本地目录 / 压缩包

```powershell
git clone https://github.com/wwwh7-cypher/codetrail-dsh.git
```

然后在 DSH 中：

```text
plugin_manager install_bundle  target = <克隆目录的绝对路径>
```

卸载：

```text
plugin_manager remove_bundle  target = codetrail-dsh
```

## 使用

对话中直接请求，例如「扫描 `E:\project` 并看架构」「审查这次 Git 修改的影响」；或让 Agent 显式调用：

```text
code_trail_scan { repo: "E:\\project" }
code_trail_query { graph: "<graph.json>", action: "modules" }
code_trail_query { graph: "<graph.json>", action: "search", text: "parseConfig" }
code_trail_review { repo: "E:\\project", base: "HEAD~1" }
```

面板里点「扫描目录 / 审查修改」选择仓库，结果会立即出现在列表；「新窗口打开」可在浏览器打开同一份 HTML。

## 配置

无需 profile 配置。可用环境变量：

- `CODETRAIL_BIN`：覆盖内置二进制路径（例如指向自己编译的 `code-trail.exe`）。
- `DSH_HOME`：决定数据目录（沿用 DSH 自身约定，默认 `C:\Users\<user>\.dsh\codetrail`）。

记录保存在 `<DSH_HOME>/codetrail/`：`index.json` 索引 + `scans/<id>/` 下的 HTML、graph JSON、parse cache、review 报告；删除该目录即可清空历史。

## 数据、安全与边界

- Rust 分析器只读源码；插件只写 `<DSH_HOME>/codetrail/`。
- HTTP 桥 `/codetrail/api/*` 只接受带 `x-codetrail: 1` 头的同源 JSON 请求；`view` 是只读 GET；扫描路径必须是已存在的目录。
- 静态分析只说明潜在影响，不证明运行时行为；未解析调用不等于不可达，模块边只聚合已解析的跨模块函数调用。
- `code_trail_review` 依赖本机 `git`。若仓库属主与当前用户不一致，Git 会拒绝运行，需要先 `git config --global --add safe.directory <repo>`（Git 自身的安全策略）。
- 面板用 iframe 承载原版工作台：完整保留交互，主题通过注入桥跟随 DSH 明暗；工作台自身的主题按钮仍可用。

## 构建

本仓库自带构建好的 Windows x64 二进制，直接安装即可。从源码重建：

1. 在 [CodeTrail](https://github.com/wwwh7-cypher/CodeTrail) 仓库执行 `pwsh -File scripts/build.ps1`，得到 `bin/code-trail.exe`；
2. 复制到本仓库 `bin/code-trail.exe`；
3. `npm pack` 生成发布包（或直接 `plugin_manager install_bundle` 指向目录）。

## 验证摘要

- 0.2.0：在本机 DSH desktop profile 安装 applied；4 个工具实跑通过（整仓 960 函数 / 831 边 / 3992 未解析；review `HEAD~1` 722 变更函数）；面板 `/codetrail/view/<id>` 返回 200 且命中全部新前端标记。
- 上游回归：CodeTrail `cargo test --locked` 66 passed；`verify-native.mjs` exit 0；`verify-explorer.cjs` 26/26 checks、consoleErrors=[]。
- 面板在浏览器中的视觉外观未由自动化验收，需人工打开确认。

## 许可

本仓库以 **AGPL-3.0** 发布（见 [LICENSE](LICENSE)）。内置的 CodeTrail Rust 二进制、HTML 模板与查看器资源来自 [CodeTrail](https://github.com/wwwh7-cypher/CodeTrail)，按 **MIT** 许可分发；本插件新增的 Host/Client 代码与文档按本仓库许可证分发。
