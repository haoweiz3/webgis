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
4. **不依赖付费或需备案的服务**：底图默认高德（无需 key），可选 Esri 全球影像与 Esri 地形晕渲（`server.arcgisonline.com`，无需 key，WGS-84 口径不纠偏）与天地图（`VITE_TIANDITU_KEY`，免费申请）。地形**默认用项目自带的本地 FABDEM 格网自建 TerrainProvider**（离线可用，见 5.5.1），拿不到本地数据时回退 ArcGIS 全球地形（无需 key）。**不使用 Cesium ion 令牌**（`imageryProvider: false`）。
5. **数据必须是可解释的演示数据**：所有空间与时序数据都要在 README 与界面中标注"演示数据，不作为决策依据"。
6. **不破坏模块契约**：任何新功能必须是实现了 `init(ctx)` / `destroy()` 的模块，不允许在 App.vue 或组件里直接堆 Cesium 代码。
7. **代码注释、界面文案、文档一律中文**（代码标识符用英文）。

---

## 3. 环境与命令

```bash
pnpm install      # 首次需要联网
pnpm build:data   # 重新生成 public/data（数据源路径可用 SOURCE_DATA_DIR 覆盖）
pnpm fetch:water  # 取真实水系（Overpass / OSM）→ scripts/data-src/yangtze-water.json
pnpm fetch:dem    # 取 30 m 高程格网（AWS terrarium）→ scripts/data-src/dem-grid.bin
pnpm analyze:flood # 栅格法淹没分析（基准标定 + 连通性 + 与示意单元法对比）
pnpm import:fabdem # 导入 FABDEM GeoTIFF → 研究区 100 m 格网（--write 才写盘）
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
src/core/cesium/      引擎层：viewerFactory（视图工厂 + WebGL 检测）、camera、coord（屏幕拾取）、geoUtils（测地线/球面面积/地形剖面/高程基准换算）、localDemTerrain（本地 DEM 自建 TerrainProvider）、gcj02 + gcjTilingScheme（高德底图 GCJ-02 纠偏）
src/core/platform/    平台层：defineModule（模块契约）、moduleRegistry（注册/挂载/启停/图层）、createContext（上下文）、事件总线、holder（viewer/registry/context 持有器、onContextReady 时序回调）
src/core/diagnostics.js  运行期错误收集（显示在加载界面）
src/stores/           scene（底图/地形/图层/读数/激活工具）、time（时间轴）、data（空间要素 + 时序 + 水位真值）、nav（HUD 导航历史）
src/modules/          11 个功能模块（见下）
src/components/hud/   9 个 HUD 组件（顶栏、图层、分析、站点、时间轴、剖面、属性卡、状态栏、提示）
src/config/scene.js   场景与业务参数（水位、基准偏移、底图、图层分组、专题字段）
scripts/build-data.mjs  数据生成脚本（示意回退 + 真实水系派生）
scripts/fetch-water-osm.mjs  真实水系取数脚本（Overpass / OSM，输出到 scripts/data-src/）
scripts/fetch-dem-terrarium.mjs  高程格网取数脚本（AWS terrarium 30 m 瓦片 → 100 m 格网）
scripts/analyze-flood-raster.mjs 栅格法淹没分析（基准标定 / 连通性 / 与单元法对比 / 预览图 / --export-masks 导出浏览器掩膜）
scripts/data-src/      取数中间成果（yangtze-water.json，ODbL 1.0；dem-grid.bin/json；raw-osm-water.json 与 dem-tiles/ 为缓存，不入库）
public/data/          8 个演示数据文件 + 本地 DEM 格网（dem-grid.bin/json，供自建地形与栅格淹没用）+ 淹没掩膜（flood-mask.bin/json，bit0 河道种子 / bit1 堤线屏障）
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

### 5.5.1 三维地形已换成本地 DEM（2026-10，已接入）

用户反馈"地形起伏打开了也看不出地形"，查清并解决：

- **复测结论（`node scripts/_terrain-check.mjs`）**：ArcGIS Terrain3D 用 `getSamples` 逐点问，研究区内 **汉口江边 / 龟山 / 蛇山 / 珞珈山 / 喻家山 / 后湖 / 长江河道全部返回 24.8 m**，只有研究区外的木兰山是 286.3 m。所以"打开地形看不出起伏"不是加载失败，是服务本身在该尺度上就是平的。本地格网的高程结构用 `node scripts/_dem-stats.mjs` 复核（河道 15.0 m、两岸 20~28 m、珞珈山 105 m）。
- **解决方式**：`src/core/cesium/localDemTerrain.js` 用项目自带的格网（`public/data/dem-grid.bin` + `dem-grid.json`）在浏览器里现搭一个 `Cesium.CustomHeightmapTerrainProvider`，离线可用、不依赖在线地形服务。**数据源是 FABDEM V1-2（布里斯托大学，去建筑/去树冠，派生自 Copernicus DEM GLO-30），原生 1 弧秒（约 30 m），由 `scripts/import-fabdem.mjs` 重采样成 0.001°（约 96 m × 111 m）的 1000×720 格网**；它跟旧的 `dem-grid-srtm.*`（AWS terrarium / SRTM 那份）不是一套数据。格网行序是"南→北"，Cesium 高度场要求"北→南"，换算在 `sampleGrid` 里。
- **效果（可用状态栏"地面高程"复核）**：长江河道 15.0 m、左岸地面 23.5 m、珞珈山一带可达 100 m 量级；打开"地形起伏"后剖面曲线不再是水平线。
- **垂直口径**：FABDEM 是 EGM2008，这里按**相对口径**直接当场景高程用（`LOCAL_DEM.verticalShiftM = 0`）——基准水位（23.93 m 吴淞 → 场景 15.93 m）与格网里的长江水面（15.0 m）只差约 1 m，河床/江滩/岸上地面的相对关系自洽。绝对基准仍由 `DATUM_OFFSET_M` 决定，**淹没面积一类量算不使用这份地形**。
- **`terrain` 模块的降级链**：本地 DEM → ArcGIS 在线地形 → 椭球面，每级都有 toast 说明；`scene.terrainSource` 记录当前来源（`local-dem` / `arcgis-online` / `ellipsoid`）。
- **坑 1：`CustomHeightmapTerrainProvider` 不支持顶点法线**（源码注释明确写了 no water mask / no vertex normals），所以**不要指望 `globe.enableLighting` 能照出地形**，平光下从正上方看起伏依然是"看不见"的。
- **坑 2：垂直夸张必须"网格与实体一起放大"**。`globe.terrainExaggeration` 只缩放地形网格、不会抬升实体，单独开会让水面被放大后的地形吞掉。现在的做法是：`terrain` 模块设置网格倍数，同时把倍数写进 `core/terrainState.js`，`geoUtils.wusongToScene()` 乘同一个倍数——所以**任何按地形高度摆放的实体都要走 `wusongToScene()`**，别再新增固定的绝对高度。
- **坑 3：自建高度场必须给瓦片层级封顶**。`CustomHeightmapTerrainProvider` 的回调返回同步数组，Cesium 会认为瓦片随时可用，于是按 `globe.maximumScreenSpaceError`（本项目 1.5）一路细分；实测不封顶时飞到 9 km 高度会把页面跑到无响应（CDP 都连不上）。现在 `LOCAL_DEM.maxLevel = 14`（回调对更深的层级返回 `undefined`，Cesium 复用父瓦片），另加 2048 条瓦片缓存。100 m 源数据在 14 级已经饱和，改这个值前先想清楚代价。
- **坑 4：HUD 里不要为同一件事放两个开关**。"三维地形起伏"和图层树里的"地形起伏"曾经各有一个勾选框、指向同一份状态，用户会以为是两件事。现在只保留图层树里的那一个，垂直夸张作为它的补充控件放在同一组。
- **看地形的正确姿势**：底图保持开启（关掉影像后地球只剩 `globeBaseColor` 纯色，看不出任何起伏），用有俯仰角的视角书签（全域概览 −55°、武汉长江大桥 −35°、天兴洲 −40°），或把底图切成新增的 **「地形晕渲」**（Esri World Hillshade，无需 key）。
- **垂直夸张（2026-10 已实现）**：`TERRAIN_EXAGGERATION.factor = 3`（`src/config/scene.js`）**固定值**。为什么要它：研究区是平原，长江河床只比两岸低 8 m，在 9~42 km 的视距下真实起伏不到几个像素——**数据正确 ≠ 看得见**。夸张只作用于显示，剖面曲线与淹没面积仍是真实高程，界面文案已注明。**曾经给过 1/2/3/5 四档选择，实测各档在常用视距下差别不明显，已删掉控件固定为 3 倍**（`terrain.setExaggeration()` 接口还留着，只是没有界面入口）。
- **高程分级设色（2026-10 已实现）**：`TERRAIN_TINT`（`src/config/scene.js`）定义**分级**边界与配色（<15 蓝 → 23~28 绿 → 35~50 橙 → ≥85 紫红）+ 晕渲参数。地形加载后由 `localDemTerrain.js` 的 `buildTintImage()` 用同一份 DEM 现场画一张 1000×720 的设色图（含晕渲明暗），作为 `SingleTileImageryProvider` 铺在地形上，属于 `layer-terrain` 图层——**关掉"地形起伏"它一起隐藏**。图例在图层管理 → 地形组里，直接用配置里的分级配色渲染色块+数值，改配色不会两边对不上。
  - **设色层不透明度 `alpha = 0.65`**：再高会把高德影像压成纯色块，0.65 能同时看清地形色带和城市路网。
  - **分级边界是实测定的，不是拍脑袋**：研究走廊（113.9~114.7E / 30.25~30.80N）高程中位 22.2 m、95% 分位 44.2 m、99.5% 分位 97.3 m、最大 260.5 m（`node scripts/_dem-stats.mjs`）。所以边界集中在 15~50 m，最上一档收在 85 m。**曾经把色带铺到 260 m，结果 95% 的地面挤在色条最左端、图例上出现一个和研究区无关的"260+ m"，已改掉**——配色的值域要按研究区定，不要按整个格网的极值定。
  - 晕渲的 `strength = 12`：100 m 格网上真实坡度只有百分之几，不放大算出来的明暗差不到 3%，肉眼看不出来。
  - **影像层顺序约定**：`basemap` 模块一律用索引 0 插入底图，`terrain` 用索引 1 插入设色层，注记保持在最上层。**新加影像层时不要用默认的追加方式（会跑到注记上面），也不要改动这个顺序**，否则换底图会把设色层盖掉。

### 5.5.2 HUD 事件订阅的时序坑（2026-10 修复）

- `Cesium.sampleTerrainMostDetailed` **要求地形服务提供 `availability`**，`CustomHeightmapTerrainProvider` 没有该属性，调用会直接抛 DeveloperError（剖面会静默退化成椭球高、曲线是平的）。因此本地 DEM 的采高走 `src/core/terrainSamplerHolder.js`：`terrain` 模块加载本地 DEM 后 `setTerrainSampler(sampleHeight)`，`geo.sampleTerrainProfile(..., sampler)` 优先用它，`ctx.localTerrainSampler` 是它在上下文里的出口。**换地形实现时记得同步处理这条链路。**
- **HUD 组件不要在 `onMounted` 里直接 `getContext()`**：上下文由 App.vue 在 `onMounted` 的异步初始化里 `setContext()`，子组件的 mounted 先于父组件执行，拿到的必然是 `null`，于是监听器永远挂不上——症状是"量算/剖面算完了但面板不显示数据"。统一用 `contextHolder.js` 的 `onContextReady(cb)`（已存在就立即回调，否则排队等 `setContext`）。
- **`清除结果` 要能收起结果面板**：`ToolPanel.clearAll()` 会调各分析模块的 `clear()` 并发 `analysis:cleared`，`ProfileChart` 必须监听这个事件把面板置空，否则面板会一直浮在场景中间、挡住后续点选。

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
| `terrain` | 三维地形 | `layer-terrain` | 本地 FABDEM 自建 TerrainProvider，降级链：本地 DEM → ArcGIS 在线地形 → 椭球面 |
| `water` | 水域与岸线 | `layer-water` `layer-shoreline` | 水面高度由 `effectiveWaterLevel` 驱动 |
| `bridges` | 跨江桥梁 | `layer-bridges` | 4 座桥，线要素 + 标签 + 属性卡 |
| `roads` | 主干道路网 | `layer-roads` | 800 条主干道，默认关闭、惰性挂载 |
| `stations` | 监测站点 | `layer-stations` `layer-station-labels` | 24 个站点，按字段与时间着色 |
| `timeline` | 时间轴播放 | — | 统一推进全局时间，发出 `time:changed` |
| `status` | 场景状态读数 | — | 光标经纬度/高程、相机高度、帧率 |
| `analysis-measure` | 量算工具 | `layer-measure` | 距离（椭球测地线）、面积（球面多边形） |
| `analysis-profile` | 剖面分析 | `layer-profile` | `sampleTerrainMostDetailed` 采样 + 曲线 |
| `analysis-flood` | 淹没分析 | `layer-flood` | **DEM 栅格法**：逐格判定 + 河道连通性 BFS + 堤防屏障，输出连通/未连通/水深，默认关闭 |

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

### 7.1 栅格法淹没的验证结论（做 B 方案前必读）

数据侧已验证（`pnpm fetch:dem` + `pnpm analyze:flood`，产物在 `scripts/data-src/`），三条结论决定了后续怎么走：

1. **30 m DEM 有地形信息**：AWS terrarium（SRTM 派生）实测武汉城区高差 53 m（河面 17 m、后湖 12 m、龟山 37 m、喻家山 65 m），能给出地形驱动的边界，而现在用的 ArcGIS 全球地形在武汉段是常数 24.8 m。**要替换地形/做栅格淹没，用 terrarium 这一档，不要用 ArcGIS Terrain3D。**
2. **城区 DEM 含建筑与树冠**：汉口江边向西北 2 km 的横断面在 200 m 间隔上波动 ±10 m、比真实地面高 15~30 m（读到楼顶）；5×5 中值平滑几乎不改变结果（266.9→263.6 km²），说明是系统性偏差而非椒盐噪声。**做全城淹没必须先解决这个**：去建筑 DEM（FABDEM 等）或叠加建成区掩膜，否则只能用河道走廊的窄口径。
3. **基准必须标定**：terrarium 是 EGM96 口径，实测河面中值 16.0 m，汉口站最低水位 23.87 m（吴淞）→ 标定偏移 **+7.87 m**。不同 DEM 在城区差 10 m 以上（后湖 SRTM 12 m vs GLO-90 23 m），**面积结论必须给区间与数据源口径，不能只报一个数。**

连通性结论：27.3 m 时连通淹没 266.9 km²（河道本身 247 km²，新增陆地仅 19.6 km²），而"地形上低于水位"的面积 1474 km²，差 5.5 倍——差值来自堤防（DEM 里可见 1~2 m）与城区伪高值。参照：现有示意单元法在 27.0 m 给 375.8 km²，正好落在两种口径之间。

**数据源可得性（已核查，2026-09）**：

- **FABDEM（去建筑/树冠 30 m，城区淹没的最优解）需要免费注册**：AWS 桶存在但对象非公开（403），OpenTopography 需 API key。拿到 key 后可加一个 `fetch:dem --source=fabdem` 分支，模式与天地图 tk 一致。
- **FABDEM 不在 AWS 开放数据注册表**（`registry.opendata.aws/fabdem/` 返回 404），免 key 的 S3 直连路径不存在；可行入口只有 OpenTopography（免费 API key）或 Bristol 数据仓库（1° 瓦片，下载方式需在其站点确认）。
- **FABDEM 的测量源不是新卫星**：它是 Copernicus DEM GLO-30 的机器学习后处理产品（去建筑、去树冠），而 GLO-30 来自 **TanDEM-X / TerraSAR-X** 的 X 波段雷达干涉测量（2010~2015 采集）。**没有针对中国的本地标定**：几何覆盖一致，但去建筑/去树冠的训练与辅助数据以欧美为主，国内城市与丘陵的残留会更多；它**保留堤防**（只去建筑与树）这一点对淹没分析有利，但 30 m 分辨率仍不足以反演 8~10 m 宽的堤顶高程。许可为 CC BY-NC-SA 4.0（非商用、需署名，正式使用前再核一遍）。
- **Copernicus GLO-30 免 key**（`copernicus-dem-30m`，1° 瓦片 44~47 MB，支持分段请求），但它是 DSM：实测汉口江边断面 GLO-90 为 21~37 m、SRTM 为 29~51 m，真实地面 25~30 m——**GLO 系列比 SRTM 好但仍含建筑残留**。
- **堤线可免 key 获得**（OSM 研究区内 146 个堤防要素，含「武昌长江大堤」「东西湖大堤」「汉江堤路」），但**堤顶高程没有任何免 key 权威源**：OSM 要素 0/146 带 height，30 m 格网也分辨不出 8~10 m 宽的堤。
- 因此堤防的默认口径是**区间报数**：下界=把 OSM 堤线当不可穿越屏障，上界=不考虑堤防，真实值落在两者之间；不要假装能精确模拟漫堤。

**FABDEM 已接入（2026-09 实测）**：

- 用户在布里斯托下载了 10°×10° 分块（解压出 99 个 1°×1° GeoTIFF，放在 `scripts/data-src/fabdem/`，已 gitignore）。研究区只需 `N30E113` / `N30E114`，`import-fabdem.mjs` 会按文件名自动挑选。
- **实测格式**：3600×3600、1 弧秒像元、DEFLATE、**水平差分预测器 predictor 2（按 int32 位模式差分，累加后重新解释为 float32）**、256×256 分块、`GDAL_NODATA=-9999`。解码已用独立来源交叉验证：武汉市区中心点 FABDEM 21.5 m vs GLO-90 27 m。
- **城区建筑偏差已解决**：汉口江边向西北断面 FABDEM 为 21~29 m、SRTM 为 30~47 m（真实地面 25~30 m）；河谷关系也合理（枯水期江面比岸边低 7~9 m）。做淹没分析用 FABDEM，不要再退回 SRTM。
- **但基准偏移成了新的主导误差**：城区地面集中在 22~30 m 这个窄带里，整体平移几米就翻天覆地。27 m 水位下的连通淹没面积实测：偏移 +8.87 m（自动标定）→ 267 km²；+5 m → 1410 km²；+2 m → 5301 km²；+1 m → 5591 km²（**20 倍摆动**）。自动标定与"地面 25~27 m 吴淞"这两种口径互相矛盾 4~6 m，说明 DEM 水面与模拟序列水位之间本身存在不一致。
- **结论：没有控制量就不能单值报淹没面积。** 三条出路：① 拿到堤顶高程（文献表格，哪怕几段）；② 拿到已知地面点高程；③ 改用"相对基准水位的抬升量"这一自洽口径（推荐，避开绝对基准）。在拿到 ①② 之前，面板与文档不要出现单一"淹没面积"数字。

**DEM 垂直基准已查到权威背书（2026-10）**：

- Copernicus DEM 官方产品页：`Vertical: EGM2008 (EPSG 3855)`，数据由 **TanDEM-X 任务 2011~2015 年**采集；
- OpenTopography GLO-30 元数据页：`Vertical Coordinates: WGS84 Ellipsoid/EGM2008 Geoid [EPSG: 3855]`；
- FABDEM 论文（Environ. Res. Lett. 17 (2022) 024016，doi:10.1088/1748-9326/ac4d4f）：重采样到 `COPDEM30 vertical coordinates (EGM2008)`。
- 结论：**FABDEM/GLO-30 的垂直基准是 EGM2008**，可以在文档里直接引用。
- **仍缺**：吴淞高程与 EGM2008 在武汉段的差值（按口径关系推算约 **+2 m**，用该值验算汉口江边地面 22~24 m → 24~26 m 吴淞，与公开认知吻合；+8.87 m 会让地面变 31~37 m 明显偏高，0 m 会让常水位就淹平原）。维基百科在本环境不可达，该 1.9 m 量级的关系未取得权威出处，**暂不作定论**。
- 因此 `analyze:flood` 的默认偏移仍为 0（相对口径），绝对口径必须用 `--offset=` 显式给出并标注依据。

**吴淞高程的换算依据已取得（用户提供 `docs/吴淞高程系.docx`，2026-10）**：

- 吴淞高程 = 以**上海吴淞口验潮站 1871~1900 年实测最低潮位**确定的海面为基准面；
- 词条给出各地实测换算：**宁波 `"1985国家高程基准"注记点 = "吴淞高程系统"注记点 − 1.87`、嘉兴 − 1.828**，即 **吴淞 ≈ 1985 国家高程基准 + 1.83~1.87 m**；
- 长江流域统一使用的是"七环平差"后的资用吴淞高程，起算基点为**镇江 308′ 标点（校测高程 9.391 m）**；
- 但词条**明确警告**："不能用一个简单的常差或用简单的公式来换算"，差值随地区与时期变化，长江干流自吴淞沿江而上差值逐渐减小 —— 所以这是**带不确定度的口径**，不是精确转换。
- 据此把 `analyze:flood` 的默认偏移设为 **+1.87 m（±0.5 m）**：吴淞 = DEM(EGM2008) + 1.87，其中 EGM2008↔1985 的差值只有分米级，计入不确定度；旧的自动标定值 +8.87 m 已证伪，仅留作对照。**任何结论都要配 `--offset=` 做敏感性。**

**堤线数据的两条来源与口径（2026-10）**：

1. **OSM 堤线**（`pnpm fetch:levees`）：放宽查询（含 `embankment=yes`，因为堤顶常是路）后有 **416 条**折线；但覆盖是碎片化的，真实防洪是"堤防+闸口"的闭合圈，OSM 只映射了一部分。
2. **DEM 反演脊线**（`pnpm derive:levees`）：FABDEM 的设计目标就是"去建筑、去树、**保留地形**"，堤防会被保留且形态规整（沿河连续、宽 8~10 m、高出平地面 2~4 m）。用"高程 − 半径 1.2 km 滑动平均 > 1.5 m"在河道走廊内提取脊线，得到约 11.2 万格屏障；**用 OSM 堤线验证命中率 54.4%**（说明检测器抓得住大部分堤，但 100 m 格网对 8~10 m 宽的堤仍有平滑）。
3. 两者并集进 `analyze:flood` 的屏障，27.0 m 水位下的**下界从 3028 km² 收紧到 1075 km²**（上界仍 5370 km²，新增陆地 827 km²，平均水深 3.55 m、最大 18 m）。这个下界与"只淹江滩与低洼地"的量级相符。
4. 注意：下界对脊线检测参数（滑动半径、阈值、走廊宽度）敏感，**报数时要连同参数一起给**，不要当成唯一答案。

**栅格淹没已接入三维界面（2026-10）**：

- **为什么必须换**：原来的 `analysis-flood` 用的是 `flood-bands.geojson`——沿真实岸线外扩 260 / 640 / 1150 / 1750 m 的四条环带（高程 24.0 / 25.5 / 27.0 / 28.5 m）。它的形状**天然就是"沿岸线等距离拓宽"，跟地形没有任何关系**，用户一眼就看出来了。现在 `analysis-flood` 完全改成 DEM 栅格法，示意单元法只保留一个面积数字作对照，不再出图。
- **数据链**：浏览器在本地 DEM 格网上逐格判定 + 从河道 BFS 连通，逻辑在 `src/core/flood/floodRaster.js`，与 `scripts/analyze-flood-raster.mjs` **逐条对齐**（异常低值修复 5 m / 中值 5×5、口径偏移、4 邻域连通、球面单元面积）。掩膜由 `pnpm analyze:flood --export-masks` 导出：
  - `public/data/flood-mask.bin`：`cols×rows` Uint8，**bit0 = 河道种子，bit1 = 堤线屏障**（OSM 堤线 ∪ DEM 反演脊线，与 Node 分析同一份）；
  - `public/data/flood-mask.json`：行列信息、`waterDatumOffsetM`（1.87）、种子/屏障格数。
- **同源复用**：`terrain` 模块加载本地 DEM 后把整份格网放进 `core/terrainState.js`（`setDemGrid`），上下文出口是 `ctx.demGrid`。淹没模块不再自己取一次数据，`ctx.localTerrainSampler` 也是同一条链路。
- **实测对账（必须保持）**：23.93 m 吴淞、有堤 → 连通 328.79 km²（其中河道 247.29 km²）；28.39 m、有堤 → 1900.38 km²；28.39 m、无堤 → 5751.34 km²、平均水深 5.93 m、最大 19.42 m。与 Node 分析和 `flood-theme.html` 的数字对得上（24.0 m 有堤 330.84 km²、28.5 m 有堤 1941 km² 量级一致）。
- **渲染方式（2026-10 重做，两个坑都踩过）**：把掩膜画成画布 → `SingleTileImageryProvider`（范围 = DEM 覆盖范围）→ 插到注记之下。影像层索引约定：底图 0 → 地形设色 1 → 淹没范围 → 注记。
  - **坑 A：不要把图层拆了重建。** 最早水位一变就 `imageryLayers.remove()+add()`，那一层在重建期间没有可用影像，**时间轴一播就闪**。正确做法是 Cesium 在 `GlobeSurfaceTileProvider._onLayerAdded` 里给每个图层挂了 `provider._reload()`：它清掉该图层的影像缓存、让已加载的瓦片重新请求，但**不拆图层**。于是只要 `provider._image = 新画布` + `provider._reload()` 就能原地换图。`SingleTileImageryProvider.requestImage` 返回的是 `Promise.resolve(this._image)`，所以**直接把 canvas 当图**、省掉 `toDataURL` 的 PNG 编码与解码，换图基本是即时的。
  - **坑 B：防抖会饿死。** 原先用 debounce（每次变化都重置定时器）。时间轴开到 **16 倍速**时水位每 60 ms 变一次，定时器被反复取消、**永远等不到执行**——淹没范围会冻在某个旧值上（实测从 26.97 退到 24.09 m，面板还停在 1900.38 km²）。现在改成**节流**（`MIN_INTERVAL_MS = 100`）：距上次计算足够久就立刻算，否则排一个**尾随**任务且不取消已有任务，既限频又一定跟上最新水位。
  - **画布与 ImageData 要复用**：`renderMaskToCanvas(mask, cols, rows, palette, targetCanvas)` 支持传入同一块画布，把 `ImageData` 缓存在 `canvas.__imageData` 上并按需 `fill(0)`，避免每次更新分配 2.9 MB。
- **三类结果的配色与图例**：`FLOOD_PALETTE`（`src/config/scene.js`）定义 `channel`（河道）/ `connected`（连通淹没）/ `isolated`（低于水位但未连通），三维掩膜和 `ToolPanel` 的图例共用这一份配置。
  - **`isolated` 就是"黄色的栅格"，必须解释清楚**：它不是"淹到的地方"，而是地形低于当前水位、但水进不去的位置——大多是被堤防挡在堤内的低地，少数是城区建筑/树冠残留堵住了水路。它不计入淹没面积，正是下界与上界之间的差距。27 m 有堤时这块有约 3862 km²，比连通淹没（1900 km²）还大，铺满整个平原时很扎眼，所以界面上给了「显示"低于水位但未连通"的区域」开关（关掉只是不画，统计照常）。
  - 面板里同时给「示意单元法对照」的数字，用来说明口径差异。
- **水位跳变诊断（`--levels=`，2026-10 加）**：栅格淹没是硬阈值 + 连通性模型，水位越过某个"鞍部"高程时会**整片低洼地一次性连通**，面积出现台阶式跳变。用户第一次遇到的就是 **26.60 → 26.70 m**：有堤口径下新增 19,387 格 / **206.54 km²**（占上一档 23%），其中一整块 **202.99 km²** 中心在 `114.11°E 30.53°N`（武昌南湖—汤逊湖一带），**过水鞍部在 `114.17°E 30.47°N`、高程 26.67 m（吴淞）**；同一段的无堤上界只有 5232 → 5268 km²（几乎不变），说明那片低地**一直低于水位**，只是被堤防挡住、到 26.67 m 才找到缺口连通。查法：
  `node scripts/analyze-flood-raster.mjs --levels=26.5,26.6,26.7,26.8`（会打印相邻档位的新增格数、聚簇、过水鞍部经纬度与高程）。
  - 跳变是这种模型的固有特征，不是 bug；100 m 格网还会把真实的 8~10 m 宽缺口平滑成一格，使台阶更陡。
  - **报数纪律**：任何"淹没面积"都要连同水位、堤防口径、基准偏移一起给。1.87 m 的基准偏移带 ±0.5 m 不确定度，在陡变区足以让面积差上千 km²。
- **踩过的坑**：`destroy` 里**不能按"是不是 SingleTileImageryProvider"来删层**——地形设色层是同一类型、同一范围，会一起被删掉。现在由模块 API 暴露 `getLayer()`，只删自己那一层。
- **已知重复**：`public/flood-theme.html` 里还有一份等价的 JS 实现（静态页面不能 import `src/`）。两处口径要一起改，否则又会踩"网页版和脚本结果对不上"的老坑。

**两个因缺数据而搁置的功能（明确记为后续改进项）**：

1. **闸口开启**：闸口控制"江水与堤内水体是否连通"，实现上只需给屏障掩膜加"条件放行的格"（江水位高于闸顶或手动开闸时放行），代码成本很低。**但缺数据**：OSM 研究区内名称含"闸"的 20 个要素里，19 个是地名/公交站/道路（武泰闸、津水闸路、三闸村…），真正可能是水工设施的只有 2 个（新范湾闸、童门闸），且**没有闸顶高程**。→ 等拿到闸口清单（位置 + 闸顶高程）再做。
2. **泵站抽排（内涝）**：江水漫堤时泵站可忽略，但"堤内积水"由"降雨 − 抽排能力"决定，与江水位无关，属于另一套机制（内涝）。**已有**：武汉市中心城区 2020 年泵站能力数据（分站 + 分系统，55 座泵站、总抽排 1960 m³/s）与一条设计标准（24 h 降雨 150 mm 时基本不出现大面积渍水）。**缺**：泵站**经纬度**与**汇水分区边界** → 现在只能做"降雨 vs 抽排能力"的算账式面板（不引入假坐标），做不了空间内涝斑块。
3. 注意方法：若日后做内涝，**必须用演示口径标注**（箱式水量平衡 + 汇水单元），管网级模型（SWMM 类）超出个人作品范围，只能写成升级路径。

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
5. 栅格法淹没接入界面（前置条件见 7.1：先解决城区 DEM 的建筑偏差或限定河道走廊口径）。

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
