/**
 * 临时探针：直接问 ArcGIS 全球地形服务，研究区到底有没有起伏。
 * 只读，只发网络请求，不写任何文件。
 */
const SERVICE =
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/getSamples'

const probes = [
  ['汉口江边（武汉关）', 114.2936, 30.6016],
  ['龟山', 114.2536, 30.5557],
  ['蛇山（黄鹤楼）', 114.3062, 30.5445],
  ['珞珈山（武大）', 114.3620, 30.5370],
  ['喻家山（华中科大）', 114.3600, 30.5110],
  ['后湖', 114.3280, 30.6600],
  ['木兰山', 114.3900, 31.0900],
  ['长江河道（武汉关断面）', 114.3000, 30.5950]
]

const geometry = {
  points: probes.map(([, lon, lat]) => [lon, lat]),
  spatialReference: { wkid: 4326 }
}

const url = `${SERVICE}?geometry=${encodeURIComponent(JSON.stringify(geometry))}&geometryType=esriGeometryMultipoint&returnFirstValueOnly=true&f=json`

const res = await fetch(url)
const json = await res.json()
if (json.error) {
  console.log('服务返回错误：', JSON.stringify(json.error))
  process.exit(0)
}
// 顺带探一下 Esri 世界晕渲图（备用底图候选，无需 key）
for (const level of [13, 16, 17]) {
  const n = 2 ** level
  const x = Math.floor(((114.3 + 180) / 360) * n)
  const latRad = (30.55 * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  const u = `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/${level}/${y}/${x}`
  try {
    const r = await fetch(u)
    console.log(`晕渲瓦片 L${level}: HTTP ${r.status} ${r.headers.get('content-type')} ${(await r.arrayBuffer()).byteLength} bytes`)
  } catch (e) {
    console.log(`晕渲瓦片 L${level}: 失败 ${e.message}`)
  }
}

const samples = json.samples ?? []
console.log('样点数：', samples.length)
samples.forEach((s, i) => {
  const [name] = probes[i] ?? ['?']
  const v = Array.isArray(s.value) ? s.value[0] : s.value
  console.log(String(name).padEnd(24, ' '), v === null || v === undefined ? 'null' : Number(v).toFixed(1))
})
