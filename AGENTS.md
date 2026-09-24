# AGENTS.md · 长江武汉段三维时空数据可视化平台

> **本文件是本项目的长期上下文，供同一项目下的所有任务 / 会话 / Agent 接手前阅读。**
> 动手改代码之前，先读第 2 节（硬性约束）与第 5 节（架构规范）。
> 最后更新：2026-09-24　｜　项目根目录：`D:\学习\XZD\webgis`
> （Windows 文件系统不区分大小写，`agent.md` 与 `AGENTS.md` 是同一个文件。）

---

## 1. 项目是什么

一个 **三维 GIS 时空数据可视化平台**：研究区为长江武汉段，在真实影像与地形底座上叠加水域、岸线、跨江桥梁、主干路网与监测站点，用**时间轴驱动水位、站点与淹没范围同步变化**，并提供量算、剖面、淹没三类空间分析工具。

技术栈：Vue3（组合式 API）+ Vite + 原生 JavaScript + Cesium 1.97 + ECharts 5 + Pinia + Sass。

**项目性质**：个人面试作品，目标是应聘**长江设计集团空间信息公司 · 三维平台研发岗**。因此项目的价值主张是"**平台化组织三维 GIS 能力**"（可插拔模块、图层管理、状态与事件分离、空间数据组织、空间分析），而不是"做一个好看的页面"。任何改动都必须服务于这个主张。

---

## 2. 硬性约束（不要擅自更改）

1. **不涉及水工结构内容**：不出现坝体、坝段、表孔、深孔、消能、机组等水利工程术语，也不做这类模型。界面与文档统一使用 GIS 词汇（图层、要素、属性、高程、量算、剖面、专题图、时空数据）。例外：**水位、淹没、库容**这几个概念允许出现，它们同时是空间分析对象。
2. **技术栈锁定**：Vue3 + Vite + **原生 JavaScript（不引入 TypeScript）** + Cesium 1.97 + ECharts + Pinia + Sass。
3. **不引入 UI 组件库**（不用 Element Plus / Ant Design Vue）。HUD 面板、按钮、滑杆全部自绘，这是展示 HTML/CSS 能力的一部分。
4. **不依赖付费或需备案的服务**：底图默认高德（无需 key），可选天地图（`VITE_TIANDITU_KEY`，免费申请），地形用 ArcGIS 全球地形（无需 key）。**不使用 Cesium ion 令牌**（`imageryProvider: false`）。
5. **数据必须是可解释的演示数据**：所有空间与时序数据都要在 README 与界面中标注"演示数据，不作为决策依据"。
6. **不破坏模块契约**：任何新功能必须是实现了 `init(ctx)` / `destroy()` 的模块，不允许在 App.vue 或组件里直接堆 Cesium 代码。
7. **代码注释、界面文案、文档一律中文**（代码标识符用英文）。

---

## 3. 环境与命令

```bash
pnpm install      # 首次需要联网
pnpm build:data   # 重新生成 public/data（数据源路径可用 SOURCE_DATA_DIR 覆盖）
pnpm dev          # 开发服务器 http://127.0.0.1:5173/
pnpm build        # 生产构建，产物 dist/
pnpm preview      # 预览构建产物
```

环境事实与坑：

- 本机 Node v24 / pnpm 11.5.2 / 无 `git`（PATH 中不可用，版本管理需另装或用图形客户端）。
- **pnpm 11 不再读取 `package.json` 的 `pnpm` 字段**：依赖构建白名单写在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`。
- `.npmrc` 中设置了 `verify-deps-before-run=false`，否则 `pnpm dev` 前会触发依赖校验并要求重建模块目录。
- 在 Codex 沙箱内执行 `pnpm install` / `vite build` 会因网络与子进程限制失败，需使用授权（escalated）执行；用户本机正常。
- 开发模式下滑块与新功能改动均走 Vite HMR，改完代码提示用户刷新即可。

---

## 4. 目录职责

```
src/core/cesium/      引擎层：viewerFactory（视图工厂 + WebGL 检测）、camera、coord（屏幕拾取）、geoUtils（测地线/球面面积/地形剖面/高程基准换算）
src/core/platform/    平台层：defineModule（模块契约）、moduleRegistry（注册/挂载/启停/图层）、createContext（上下文）、事件总线、holder（viewer/registry/context 持有器）
src/core/diagnostics.js  运行期错误收集（显示在加载界面）
src/stores/           scene（底图/地形/图层/读数/激活工具）、time（时间轴）、data（空间要素 + 时序 + 水位真值）
src/modules/          11 个功能模块（见下）
src/components/hud/   9 个 HUD 组件（顶栏、图层、分析、站点、时间轴、剖面、属性卡、状态栏、提示）
src/config/scene.js   场景与业务参数（水位、基准偏移、底图、图层分组、专题字段）
scripts/build-data.mjs  数据生成脚本
public/data/          8 个演示数据文件
docs/                 简历条目、录屏脚本、面试问答
```

---

## 5. 架构规范

### 5.1 模块契约（`src/core/platform/defineModule.js`）

```js
export default defineModule({
  id: 'water',                 // 唯一标识，注册与查找用
  name: '水域与岸线',           // 图层树显示名
  group: '空间数据',            // 图层分组：影像底图 / 地形 / 空间数据 / 时空数据 / 分析图层
  description: '…',
  layers: [{ id: 'layer-water', name: '水域面', group: '空间数据', defaultVisible: true }],
  init(ctx) { /* 创建实体，返回对外 API（至少实现 setLayerVisible） */ },
  destroy(ctx, api) { /* 必须移除实体、解绑事件、停掉计时器 */ }
})
```

铁律：

- 模块**不自己 `new Cesium.Viewer`**，只使用 `ctx.viewer`；
- 模块**不直接 import 业务 store**，通过 `ctx.scene / ctx.time / ctx.data` 访问；
- 每个实体的 id 要可预测（如 `station-WL06`），`destroy` 时按 id 逐个移除；
- 使用 `ScreenSpaceEventHandler` 的模块必须实现 `destroyHandler()`，并在 `destroy` 中调用；
- 分析类模块在开始时要判断 `ctx.scene.activeTool`，避免与其它模块的点击拾取冲突。

### 5.2 注册中心（`moduleRegistry.js`）

- `register(module)` → `mount(id)` / `unmount(id)` → `setLayerVisible(layerId, visible)`；
- **惰性挂载**：`defaultVisible: false` 的图层（主干道、淹没单元）在用户第一次打开时才挂载模块，避免启动时创建大量隐藏实体；
- `setLayerVisible` 的语义：先按需挂载，再调用模块的 `setLayerVisible`；模块未实现该 API 时，关闭图层等价于卸载模块。

### 5.3 状态与事件分工

- **Pinia 存状态**（"现在是什么"）：`time.index`、`data.effectiveWaterLevel`、`data.field`、`scene.layers`、`scene.activeTool`；
- **事件总线发通知**（"刚刚发生了什么"）：`time:changed`、`analysis:result`、`analysis:cleared`、`data:stationSelected`、`data:featureSelected`、`layer:visibility`、`ui:toast`；
- 三维视觉更新优先使用 `CallbackProperty` **逐帧读取状态**，不要为了更新时间轴而销毁重建实体。

### 5.4 水位只有一个真值来源

`data.effectiveWaterLevel`（**吴淞高程**，米）是平台里水位的唯一真值：三维水面高度、淹没判定、站点着色、状态栏读数全部由它派生。两个输入：跟随时间轴取参考站 `WL06`（汉口武汉关）的模拟序列，或用户手动设定情景水位（`data.setManualLevel()` 会关闭 `time.followTime`）。

### 5.5 高程基准（GIS 专业要点，勿混用）

- 水位、滩地单元高程、警戒水位统一采用**吴淞高程**，所有分析与阈值判定都在该基准下完成；
- 仅在三维渲染时按 `src/config/scene.js` 的 `DATUM_OFFSET_M`（演示取值 −8.0 m）换算成场景高程；
- 剖面曲线取自地形服务（近似 EGM96 口径），要与水位数据直接比较时必须先做基准转换 —— 这一点在文档与界面里都做了说明，不要"顺手"把两者混算。

---

## 6. 现有模块（11 个）

| 模块 id | 名称 | 图层 id | 说明 |
| --- | --- | --- | --- |
| `basemap` | 底图与注记 | `layer-imagery` `layer-annotation` | 高德影像/矢量、天地图（需 tk） |
| `terrain` | 三维地形 | `layer-terrain` | ArcGIS 全球地形，失败回退椭球面 |
| `water` | 水域与岸线 | `layer-water` `layer-shoreline` | 水面高度由 `effectiveWaterLevel` 驱动 |
| `bridges` | 跨江桥梁 | `layer-bridges` | 4 座桥，线要素 + 标签 + 属性卡 |
| `roads` | 主干道路网 | `layer-roads` | 800 条主干道，默认关闭、惰性挂载 |
| `stations` | 监测站点 | `layer-stations` `layer-station-labels` | 24 个站点，按字段与时间着色 |
| `timeline` | 时间轴播放 | — | 统一推进全局时间，发出 `time:changed` |
| `status` | 场景状态读数 | — | 光标经纬度/高程、相机高度、帧率 |
| `analysis-measure` | 量算工具 | `layer-measure` | 距离（椭球测地线）、面积（球面多边形） |
| `analysis-profile` | 剖面分析 | `layer-profile` | `sampleTerrainMostDetailed` 采样 + 曲线 |
| `analysis-flood` | 淹没分析 | `layer-flood` | 单元高程判定 + 面积累加，默认关闭 |

---

## 7. 数据规范

`scripts/build-data.mjs` 生成 8 个文件到 `public/data/`（重新生成后需刷新页面）：

| 文件 | 内容与当前规模 | 口径 |
| --- | --- | --- |
| `water.geojson` | 长江武汉段水域面（约 135 km²） | **示意简化几何**：中心线按河宽偏移生成 |
| `shoreline.geojson` | 左右岸岸线 2 条 | 同上 |
| `flood-bands.geojson` | 8 个滩地单元（4 类高程 × 2 岸），合计约 361 km² | 高程 24.0 / 25.5 / 27.0 / 28.5 m（吴淞）；面积按球面公式预计算 |
| `stations.geojson` | 24 个站点：水位站 8、水质站 7、雨量站 9 | 真实站点名称与河段位置，警戒水位参考公开资料（汉口 27.30 m 吴淞） |
| `bridges.geojson` | 4 座跨江大桥 | 真实坐标与公开简介 |
| `roads-main.geojson` | 800 条主干道（约 443 KB） | 从本地路网筛选国道/省道/快速路并抽稀 |
| `series.json` | 96 小时逐小时序列（24 站点） | **模拟数据**：雨峰 → 涨水 → 洪峰 → 退水；汉口洪峰 28.40 m，超警戒 18 小时，流量峰值约 6.5 万 m³/s |
| `meta.json` | 数据说明、口径、要素计数 | — |

数据源默认路径 `D:/学习/XZD/Part3/smart-city-wuhan/src/assets`（`Wuhan_bridge.json`、`Wuhan_roads.json`），可用 `SOURCE_DATA_DIR` 覆盖；源文件缺失时脚本会跳过对应文件并提示。

---

## 8. 当前状态

已完成：

- 平台层与 11 个模块、9 个 HUD 组件、全部演示数据与数据生成脚本；
- 生产构建通过（627 modules）；开发服务器下所有模块与数据文件返回 200 且无转换错误；
- 注册中心行为用 Node 脚本验证（惰性挂载 / 可见性透传 / 批量销毁）；
- 球面面积公式校核（赤道 0.01° 方格：1.0653 km² vs 平面近似 1.0677 km²，偏差 0.23%）；
- 文档：`README.md`、`docs/简历项目条目.md`、`docs/录屏讲解脚本.md`、`docs/面试高频追问与参考答案.md`。

已知问题与未验证项：

- **浏览器端运行效果尚未由 Agent 亲眼验证**（Agent 环境无浏览器）：三维渲染与交互需要在 Chrome / Edge 中人工确认；Codex 内置浏览器可能不支持 WebGL（加载界面会明确提示）。
- 水域面与滩地为示意几何，精度不足以做真实统计。
- 淹没分析是"单元高程 + 面积累加"，未接入 DEM 栅格计算与水动力学模型。
- 无后端、无权限、无部署与监控。

下一步候选（按优先级）：

1. 接入 OSM / 天地图真实水系数据替换示意几何；
2. 加载 3D Tiles 城市/倾斜模型，验证平台调度能力；
3. 用 DEM 把淹没分析升级为栅格法并给出淹没水深；
4. 数据接口化（静态 JSON → 后端服务）与历史数据回放；
5. 部署到可访问地址（Gitee Pages / 阿里云 OSS / Vercel），简历上放链接。

---

## 9. 改动后的验证清单

任何改动都要跑一遍：

1. `pnpm build` 通过（无报错、无新增警告）；
2. `pnpm dev` 后用浏览器/HTTP 请求确认改动涉及的模块与组件能正常编译（`/src/...` 返回 200，且内容不含 `Failed to resolve` / `Transform failed`）；
3. 图层系统：新模块必须能在图层树中开关，且**反复开关后场景实体数量回到基线**（`viewer.entities.values.length`）；
4. 时间轴：拖动时间轴时新功能要跟随变化（说明它读的是状态，不是一次性快照）；
5. 术语检查：新增文案中不出现水工结构术语。

---

## 10. 术语与文案约定

- 使用：图层、要素、属性、专题图、时空数据、量算、剖面、等高线、缓冲、坐标、高程、分辨率。
- 允许：水位、淹没、库容（作为空间分析对象）。
- 禁止：坝体、坝段、表孔、深孔、溢流、消能、机组、船闸、升船机、泄洪。
- 所有涉及数据的表述都要加"演示数据"的限定，不要写成真实监测成果。

---

## 11. 给后续 Agent 的工作规则

- 先读本文件与 `README.md`，再动代码；改动若与第 2 节冲突，先向用户确认。
- 新增功能 = 新增一个模块文件 + 在 `src/App.vue` 的 `MODULES` 数组注册 + 声明 `layers`，不要在组件里写业务逻辑。
- 保持 HUD 自绘风格：深色科技风、`src/styles/main.scss` 中的 CSS 变量（`--c-accent` 等）与 `.panel` / `.btn` / `.field` / `.tag` 基础类，不要引入组件库。
- ECharts 容器若在 `v-if` 内，必须"按需初始化"（等 DOM 出现后再 `echarts.init`），并在卸载时 `dispose`。
- 改完及时同步文档：功能变化更新 `README.md`，工作内容变化更新 `docs/简历项目条目.md`，演示流程变化更新 `docs/录屏讲解脚本.md`。
- 需要联网的操作（安装依赖、下载数据）在本机执行前先确认网络可用；沙箱内需申请授权。
