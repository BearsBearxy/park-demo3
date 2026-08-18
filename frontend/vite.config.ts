import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // 目标浏览器口径与 index.html 的 <script type="module"> 一致,es2020 覆盖 Chrome87+/Safari14+
    target: 'es2020',
    // 用 esbuild 不用 terser:快 20~40 倍,体积只差 1~3%。内部系统没有防逆向诉求,
    // 为了那 2% 把 30s 的构建拖成几分钟不划算(这行也是防人日后"顺手"换 terser 的备忘)。
    minify: 'esbuild',
    // sourcemap 必须 false:dist 直接 COPY 进 nginx 镜像,而 /assets/ 给的是 expires 1y + immutable,
    // 且没有任何 location 拦 .map —— 'hidden' 只是不写 //# sourceMappingURL,文件名规则是
    // <chunk>-<hash>.js.map,从 index.html 拿到 js 名补个 .map 就能取走全部源码(实测 123 个 .map/13MB,
    // dist 从 4MB 涨到 17MB)。部署目标是公网明文 HTTP,等于整站源码敞开。
    // 将来若接错误追踪平台:改成 'hidden' 并在 CI 里把 .map 上传后**从产物里删掉**,绝不随镜像发布;
    // nginx 侧已加 `location ~ \.map$ { return 404; }` 作为第二道闸。
    sourcemap: false,
    // echarts(693KB)/exceljs(938KB)两大块是刻意的懒加载(见下 manualChunks 注释),默认 500KB 恒定告警。
    // 阈值压到 700 的话 exceljs 每次构建必红,常亮的告警等于没有告警;设 1000 =「比现有最胖的还胖」才叫。
    chunkSizeWarningLimit: 1000,
    // cssCodeSplit 保持默认 true:每个路由块带自己的 CSS,首屏不背全站样式
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // 业务代码一律不手切。Rollup 已经按路由的动态 import 自动分块了,
          // 手写规则去覆盖业务模块,最常见的翻车是把 A 屏和 B 屏并进一块 ——
          // 访问 A 被迫下载 B 的代码,比不切还糟。手切只用于 node_modules 里的重型库。
          if (!id.includes('node_modules')) return
          // 这两个库现在靠「全站只有 await import 引用它」自然独立成块(exceljs 见 utils/sheet.ts、
          // utils/billNoticeExcel.ts;echarts 见 components/ana/echartsBundle.ts)。这里显式钉死:
          // 将来谁不小心在某个屏顶层静态 import 了它,也只是多一条依赖边,不会被压进那个屏的 chunk。
          if (id.includes('exceljs')) return 'exceljs'
          if (/node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return 'echarts'
          // 框架三件套首屏必用、几个月才动一次版本,单独成块吃 /assets/ 的 immutable 永久缓存:
          // 业务代码天天发版也不会作废它这一块。
          if (/node_modules[\\/](vue|vue-router|pinia|@vue)[\\/]/.test(id)) return 'vue'
          // 其余依赖(axios/lucide/fflate…)故意不设 vendor 兜底块:fflate 只被
          // billNoticeExcel.ts:619 的 await import 拉起,塞进兜底块会被首屏 eager 块连坐拖起来。
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 8080 落在 Windows 排除端口段 8017-8116 绑不上,后端改 8181(与 .claude/launch.json 同步)
        target: 'http://localhost:8181',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
