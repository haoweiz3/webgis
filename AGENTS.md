# AGENTS.md · 长江武汉段三维时空数据可视化平台

> **本文件是本项目的长期上下文，供同一项目下的所有任务 / 会话 / Agent 接手前阅读。**
> 动手改代码之前，先读第 2 节（硬性约束）与第 5 节（架构规范）。
> 最后更新：2026-09-26　｜　项目根目录：`D:\学习\XZD\webgis`
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
4. **不依赖付费或需备案的服务**：底图默认高德（无需 key），可选 Esri 全球影像（`server.arcgisonline.com`，无需 key，WGS-84 口径不纠偏）与天地图（`VITE_TIANDITU_KEY`，免费申请），地形用 ArcGIS 全球地形（无需 key）。**不使用 Cesium ion 令牌**（`imageryProvider: false`）。
5. **数据必须是可解释的演示数据**：所有空间与时序数据都要在 README 与界面中标注"演示数据，不作为决策依据"。
6. **不破坏模块契约**：任何新功能必须是实现了 `init(ctx)` / `destroy()` 的模块，不允许在 App.vue 或组件里直接堆 Cesium 代码。
7. **代码注释、界面文案、文档一律中文**（代码标识符用英文）。

---

## 3. 环境与命令

```bash
pnpm install      # 首次需要联网
pnpm build:data   # 重新生成 public/data（数据源路径可用 SOURCE_DATA_DIR 覆盖）
pnpm fetch:water  # 取真实水系（Overpass / OSM）→ scripts/data-src/yangtze-water.json
pnpm verify:gcj02 # 坐标纠偏回归校核（互转精度 + 各层级贴图残差）
pnpm verify:data  # 空间数据体检（环闭合、贴岸距离、桥梁断面对照、自交检查）
pnpm verify:camera # 相机飞行校核（飞到目标后目标是否落在视图中心）
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
src/core/cesium/      引擎层：viewerFactory（视图工厂 + WebGL 检测）、camera、coord（屏幕拾取）、geoUtils（测地线/球面面积/地形剖面/高程基准换算）、gcj02 + gcjTilingScheme（高德底图 GCJ-02 纠偏）
src/core/platform/    平台层：defineModule（模块契约）、moduleRegistry（注册/挂载/启停/图层）、createContext（上下文）、事件总线、holder（viewer/registry/context 持有器）
src/core/diagnostics.js  运行期错误收集（显示在加载界面）
src/stores/           scene（底图/地形/图层/读数/激活工具）、time（时间轴）、data（空间要素 + 时序 + 水位真值）、nav（HUD 导航历史）
src/modules/          11 个功能模块（见下）
src/components/hud/   9 个 HUD 组件（顶栏、图层、分析、站点、时间轴、剖面、属性卡、状态栏、提示）
src/config/scene.js   场景与业务参数（水位、基准偏移、底图、图层分组、专题字段）
scripts/build-data.mjs  数据生成脚本（示意回退 + 真实水系派生）
scripts/fetch-water-osm.mjs  真实水系取数脚本（Overpass / OSM，输出到 scripts/data-src/）
scripts/data-src/      取数中间成果（yangtze-water.json，ODbL 1.0；raw-osm-water.json 为缓存，不入库）
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
- **地形服务是好的，但这份全球 DEM 在武汉段几乎没有起伏**：ArcGIS 全球地形（Terrain3D）实测——跨龟山 2 km 断面、20 m 间距的 101 个点高程全部为 24.8 m（高差 0.0 m），汉口向西北 20 km 也完全同值；真实世界里的龟山（约 90 m）、蛇山、珞珈山与长江河道下切都被这份粗格网抹平了，**放大也看不出来**。服务本身正确（实测拉萨 4959.9 m、神农架 1223.5 m、木兰山 286.3 m）。所以研究区剖面是水平线属于数据口径事实，不要当 bug"修"；要展示地形能力，就把剖面线放到研究区外围，或换更高分辨率 DEM（30 m 级 Copernicus / ALOS，或自实现基于 AWS terrarium 高度瓦片的 TerrainProvider）。

### 5.6 坐标系统一（底图纠偏）

- **平台真值坐标一律是 WGS-84 / 2000 国家大地坐标系**：矢量数据、量算、剖面采样、淹没判定、状态栏读数都在该坐标系下，不得为了让底图好看而把业务数据转成 GCJ-02；
- 高德瓦片是 GCJ-02 加密坐标，与 WGS-84 在武汉段相差 568~604 m（方位 115°~120°），直接叠加必然错位；纠偏只作用在底图瓦片这一层，由 `src/core/cesium/gcjTilingScheme.js` 实现（索引按高德网格请求、显示范围逆变换回 WGS-84）；**新增任何高德瓦片图层都要挂上 `gcj02TilingScheme()`**；
- 天地图影像/注记与 ArcGIS 地形本身即 WGS-84 口径，**不要**给它们加纠偏；
- 不要用"统一加固定偏移量"的简化做法：GCJ-02 是位置相关的非线性加密，偏移量沿河段从 604 m 变到 568 m、方位摆动 5°，固定偏移只能让中段对上；
- 改动坐标相关代码后跑 `pnpm verify:gcj02`：互转往返误差应远小于一个像素，各层级贴图残差应 < 0.5 px，相邻瓦片不得留缝。

---

## 6. 现有模块（11 个）

| 模块 id | 名称 | 图层 id | 说明 |
| --- | --- | --- | --- |
| `basemap` | 底图与注记 | `layer-imagery` `layer-annotation` | 高德影像/矢量（经 GCJ-02 → WGS-84 纠偏）、天地图（需 tk） |
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
| `water.geojson` | FeatureCollection：长江主河道 9 段 + 汉江 6 段，合计约 306 km²，含 16 个江心洲（内环） | **真实水系**：OpenStreetMap（`natural=water` + `water=river`），WGS-84，ODbL 1.0 |
| `shoreline.geojson` | 33 条岸线：逐河段的左右岸 + 江心洲 | 由 OSM 水域面按主轴拆分、按中心线判左右 |
| `flood-bands.geojson` | 8 个滩地单元（4 类高程 × 2 岸），合计约 577 km²；几何为 MultiPolygon（每河段一环） | 沿真实岸线外扩 260 / 640 / 1150 / 1750 m；高程 24.0 / 25.5 / 27.0 / 28.5 m（吴淞）为演示取值 |
| `stations.geojson` | 24 个站点：水位站 8、水质站 7、雨量站 9 | 真实站点名称与河段位置，警戒水位参考公开资料（汉口 27.30 m 吴淞）；水位站/水质断面由真实锚点投到水面边界（`anchor` 字段随数据发布） |
| `bridges.geojson` | 4 座跨江大桥 | 真实坐标与公开简介 |
| `roads-main.geojson` | 800 条主干道（约 443 KB） | 从本地路网筛选国道/省道/快速路并抽稀 |
| `series.json` | 96 小时逐小时序列（24 站点：水位站 8 + 水质站 7 + 雨量站 9） | **模拟数据**：面雨量峰值 9.1 mm/h、累计 186 mm（单站累计 162~313 mm）→ 涨水 → 洪峰 → 退水；汉口洪峰 28.39 m（超警戒 18 小时）、流量峰值约 6.5 万 m³/s；洪峰自上游向下游滞后 0~5 小时 |
| `meta.json` | 数据说明、口径、要素计数 | — |

数据源默认路径 `D:/学习/XZD/Part3/smart-city-wuhan/src/assets`（`Wuhan_bridge.json`、`Wuhan_roads.json`），可用 `SOURCE_DATA_DIR` 覆盖；源文件缺失时脚本会跳过对应文件并提示。

真实水系由 `pnpm fetch:water` 取到 `scripts/data-src/yangtze-water.json`（覆盖研究区外扩一圈、裁剪到 `[113.78, 30.12, 114.82, 30.88]`、抽稀 12 m）。**该文件缺失时 `build-data.mjs` 自动回退到示意几何**（仅手写中心线，不含江心洲）；引用 OSM 数据时必须在文档与 `meta.json` 中保留 "© OpenStreetMap contributors，ODbL 1.0" 署名。

河道几何的两条铁律（踩过坑）：

1. **不要用 OSM 的 `waterway=river` 折线当中心线**：它在汊道与分汇流处分叉，拼起来会横跳 20 km，据此外扩的滩地会挂到几百米外的陆地上；正确做法是逐段由两岸配对生成中心线。
2. **不要跨河段拼岸线再外扩**：河段之间有断口，拼接后的环会自己绕回去（实测每环 8~35 处自交）；正确做法是逐段成环、用 MultiPolygon 表达，外圈再跑一次 `removeReversals()` 去回折（单环自交降到 ≤ 4 处）。
3. **站点不要按"里程比例 t"定位**：中心线点会因落在陆地/江心洲被剔除，按数组下标或里程插值都会把站点整体推向上游（实测武汉关水位站偏 20 km）。现在每个站带真实锚点 `at`，生成时投到该河水面边界上；锚点本身也要按真实水系核对，手写控制点可能偏几公里（白浒山就偏了 8 km）。
4. **水位序列的涨水幅度与洪峰滞后必须显式给**：`amp`（米）与 `lag`（小时）写在 `WATER_LEVEL_STATIONS` 的站点定义里。曾经用里程比例 `s.t` 推算（`amplitude = 5.2 - s.t * 1.2`），站点改用真实锚点 `at` 后该字段消失，`NaN` 被 `JSON.stringify` 序列化成 `null`，导致**时间轴驱动水位这条主线静默失效**：水面固定在默认值 24.5 m、淹没分析不随水位变化、水位站永不变红、数值标注空白、水位过程线空图、洪峰按钮跳回第 0 帧。改完序列生成逻辑必须扫一遍 `series.json` 有没有 `null`。
5. **降雨量级集中在 `RAIN_SCALE`**：96 小时面雨量标定到约 186 mm、峰值 9.1 mm/h（武汉一次区域性暴雨）。标定前累计 668 mm、峰值 35 mm/h，接近年均降水（约 1300 mm）的一半，量级失真。

---

## 8. 当前状态

已完成：

- 平台层与 11 个模块、9 个 HUD 组件、全部演示数据与数据生成脚本；
- 生产构建通过（629 modules）；开发服务器下所有模块与数据文件返回 200 且无转换错误；
- 注册中心行为用 Node 脚本验证（惰性挂载 / 可见性透传 / 批量销毁）；
- 球面面积公式校核（赤道 0.01° 方格：1.0653 km² vs 平面近似 1.0677 km²，偏差 0.23%）；
- 高德底图 GCJ-02 纠偏已实现并用 `pnpm verify:gcj02` 校核（互转往返误差 1e-8 m 量级；瓦片索引与高德网格完全一致；各层级贴图残差 < 0.5 px，相邻瓦片不留缝）；
- 真实水系已接入（`pnpm fetch:water` 从 OSM 取数，`water.geojson` 为 FeatureCollection 含江心洲内环，`flood-bands.geojson` 为 MultiPolygon）；`pnpm verify:data` 全部通过：水域面 15 个 / 306 km²、岸线 33 条、滩地内圈与真实岸线距离 0 m、8 个水位站全部落在水面内、武汉长江大桥主跨两端点回到岸边（此前被示意河道覆盖 138~172 m）；
- 时序数据已修复并标定：水位/流量序列此前因 `s.t` 字段消失而全为 `null`（时间轴不驱动水位），现改为每站显式 `amp` / `lag` —— 8 个水位站峰值 27.63~29.72 m、全部超警戒 16~32 小时、流量峰值 5.6~8.2 万 m³/s，洪峰自上游向下游滞后 0~5 小时；汉口过程 23.93 m（起点）→ 28.39 m（洪峰，第 54 小时）→ 24.09 m（末帧），对应淹没面积 0 → 376 → 85 km²，时间轴驱动重新生效；降雨按 `RAIN_SCALE = 0.27` 标定；
- 文档：`README.md`、`docs/简历项目条目.md`、`docs/录屏讲解脚本.md`、`docs/面试高频追问与参考答案.md`。

已知问题与未验证项：

- **浏览器端运行效果尚未由 Agent 亲眼验证**（Agent 环境无浏览器）：三维渲染与交互需要在 Chrome / Edge 中人工确认；Codex 内置浏览器可能不支持 WebGL（加载界面会明确提示）。
- 滩地淹没单元仍是示意单元（沿真实岸线外扩，高程为演示取值），大距离外扩在凹岸有轻微几何折叠（单环自交 ≤ 4 处），精度不足以做真实统计。
- 淹没分析是"单元高程 + 面积累加"，未接入 DEM 栅格计算与水动力学模型。
- 无后端、无权限、无部署与监控。

下一步候选（按优先级）：

1. 加载 3D Tiles 城市/倾斜模型，验证平台调度能力；
2. 用 DEM 把淹没分析升级为栅格法并给出淹没水深；
3. 数据接口化（静态 JSON → 后端服务）与历史数据回放；
4. 部署到可访问地址（Gitee Pages / 阿里云 OSS / Vercel），简历上放链接。

---

## 9. 改动后的验证清单

任何改动都要跑一遍：

1. `pnpm build` 通过（无报错、无新增警告）；
2. `pnpm dev` 后用浏览器/HTTP 请求确认改动涉及的模块与组件能正常编译（`/src/...` 返回 200，且内容不含 `Failed to resolve` / `Transform failed`）；
3. 图层系统：新模块必须能在图层树中开关，且**反复开关后场景实体数量回到基线**（`viewer.entities.values.length`）；
4. 时间轴：拖动时间轴时新功能要跟随变化（说明它读的是状态，不是一次性快照）；
5. 术语检查：新增文案中不出现水工结构术语。
6. 坐标相关改动：跑 `pnpm verify:gcj02`，并确认矢量与高德影像仍对齐（底图切到天地图时应无偏移、切回高德也不应有 600 m 错位）。
7. 空间数据相关改动：跑 `pnpm verify:data`（水域面环闭合与内环、水位站在水面内、滩地内圈贴岸、桥梁断面对照、滩地环自交），并确认 `meta.json` 里保留了 OSM 的 ODbL 署名。
8. HUD 布局相关改动：确认左右栏面板在 1250×700（浏览器窗口）与 1920×1080 两种尺寸下**都不出现被裁掉且无法滚动**的区块，面板内容超出时必须在自身 `panel__body` 内滚动。
9. 相机相关改动：跑 `pnpm verify:camera`，确认站点定位、视角书签、初始视角的目标点都落在视图中心（< 50 m），且相机垂直高度与设定值一致。

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
- HUD 骨架尺寸集中在 `main.scss` 的 `--hud-top / --hud-bottom / --col-left / --col-right` 变量里（小屏由媒体查询收紧）；**栏内每个面板都必须有高度预算**（`flex` + `min-height: 0`，内容区自己 `overflow-y: auto`），否则内容一多就会被栏的 `overflow: hidden` 裁掉且滚不动。
- HUD 的"返回 / 前进"由 `src/stores/nav.js` 统一记录：它保存的是「选中的站点 + 打开的要素属性卡」组合快照，记录动作集中在 `App.vue` 对数据状态的一个 `flush: 'sync'` 监听里。新增可选中、可打开的面板交互时，只要走 `data.selectStation / data.selectFeature`，就自动获得返回/前进能力，不要各自维护一套历史。
- 相机飞行统一走 `src/core/cesium/camera.js` 的 `flyTo()`，内部是 `camera.flyToBoundingSphere` + `HeadingPitchRange`：**不要用 `camera.flyTo({ destination: 目标点 })`**，那会把目标点当相机位置，带俯仰角时屏幕中心偏出「高度 / tan|俯仰角|」（3200 m / -50° 偏 2.7 km，初始视角偏 29 km）。新增视角（书签、定位、快捷视图）都复用 `flyTo()`。
- 底图清晰度相关的参数集中在 `src/config/scene.js` 的 `SCENE_DEFAULTS`：`useBrowserRecommendedResolution`（必须为 false，否则高分屏按 CSS 像素渲染、底图发软）、`maxRenderPixelRatio`、`globeMaximumScreenSpaceError`（默认调为 1.5）。新增底图时注意：`kind: 'amap'` 才挂 `gcj02TilingScheme()`，Esri / 天地图 / ArcGIS 都是 WGS-84 口径，**不要**纠偏（Esri 影像用 `server.arcgisonline.com`，`services.arcgisonline.com` 在部分网络下不可达）。
- ECharts 容器若在 `v-if` 内，必须"按需初始化"（等 DOM 出现后再 `echarts.init`），并在卸载时 `dispose`。
- 改完及时同步文档：功能变化更新 `README.md`，工作内容变化更新 `docs/简历项目条目.md`，演示流程变化更新 `docs/录屏讲解脚本.md`。
- 需要联网的操作（安装依赖、下载数据）在本机执行前先确认网络可用；沙箱内需申请授权。
