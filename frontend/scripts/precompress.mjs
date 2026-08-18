// 构建后离线预压缩:给 dist 里的文本产物生成同名 .gz,nginx 的 gzip_static on 直接吐这份,
// 运行时零 CPU。离线压所以敢开 level 9(nginx 默认 gzip_comp_level 1,实测再省 ~10%)。
// 零新依赖,只用 node 内置模块。
import { gzipSync, constants } from 'node:zlib'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
// .woff2 已是压缩格式,再 gzip 只会变大;.map 不进浏览器请求路径,压了也没人拉
const EXT = /\.(js|css|html|svg|json)$/
// 比这小的文件跳过:gzip 头 + nginx 多开一次文件的开销大过收益(和 nginx gzip_min_length 一个口径,
// ⚠ gzip_static 不看 gzip_min_length,所以这条只能在这里自己把)
const MIN = 1024

// 不用 readdirSync 的 recursive 选项:Node 18.17 以下会静默忽略它,只扫到顶层一层,
// 结果是「压了 index.html 就完事」的假成功。老老实实递归。
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name),
  )
}

let n = 0
let raw = 0
let gz = 0
for (const f of walk(DIST)) {
  if (!EXT.test(f)) continue
  const buf = readFileSync(f)
  if (buf.length < MIN) continue
  const out = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION })
  if (out.length >= buf.length) continue // 压完反而变大(已压缩过的内容),留原文件让 nginx 现场决定
  writeFileSync(`${f}.gz`, out)
  n++
  raw += buf.length
  gz += out.length
}

const mb = (b) => (b / 1024 / 1024).toFixed(2)
if (n === 0) throw new Error(`precompress: ${DIST} 里一个可压文件都没有,构建产物是不是没出来?`)
console.log(`precompress: ${n} 个文件 ${mb(raw)}MB → ${mb(gz)}MB (${((1 - gz / raw) * 100).toFixed(1)}% off)`)
