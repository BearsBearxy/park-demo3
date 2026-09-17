// 产品名 —— 全站只有这一处。浏览器标签页标题(vite.config.ts 构建时写进 index.html)、
// 登录页左上角、侧栏标志的替代文字都读这里;改完重启 dev / 重新构建即生效。
//
// 标志图形是另一个文件:src/assets/brand/logo.svg(浏览器标签页图标、侧栏、登录页标志与粒子动画共用)。
// 换图形就用新 svg 同名覆盖它;新图的 viewBox 最好裁到图形本身、四周只留一点边,
// 否则 22px 的侧栏标志和标签页图标会显得很小。
//
// ⚠ 本文件会被 vite.config.ts 在 Node 里导入,不要在这里 import 任何图片或浏览器专用模块。
export const BRAND = {
  name: '灵睿',
  nameEn: 'LinkSight',
}

/** 浏览器标签页标题 */
export const BRAND_TITLE = `${BRAND.name} ${BRAND.nameEn}`
