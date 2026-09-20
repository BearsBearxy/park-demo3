# 灵睿 LinkSight 产品展示站

对外的单页产品站。**零构建、零后端、零依赖**：这个目录就是发布目录，托管方直接当静态文件发。

设计稿：`docs/superpowers/specs/2026-09-05-showcase-site-design.md`（§4 逐章版式与动效、§5 转场、§6 素材、§9 验收）。
可滚动的动效原型（带设计批注）：`../运维文档/设计稿/未实现/产品展示站-2026-09-05/prototype.html`。

## 目录

```
site/
  index.html        15 章正文，无批注、无组件表
  styles.css        全部样式，颜色只走 CSS 变量
  main.js           GSAP 滚动动效 + 素材装载
  vendor/           gsap.min.js / ScrollTrigger.min.js（3.12.5，自带不走 CDN）
  assets/           录屏与截图，文件名见 assets/README.md
  favicon.svg       产品标志的两档灰版
  _headers          缓存：assets 与 vendor 一年，HTML 不缓存
```

## 本地看

```bash
python -m http.server 8080 --directory site
```

然后开 http://localhost:8080 。直接双击 `index.html` 也能看，只是录屏在 `file://` 下可能不自动播。

## 发布（Cloudflare Pages）

| 设置 | 值 |
|---|---|
| 连接 | 这个仓库，分支自选 |
| Build command | **留空** |
| Build output directory | `site` |
| Root directory | 仓库根（或直接把 `site` 设成 root，两种都行，别两边都填） |

Netlify / Vercel 同理：publish directory 填 `site`，build command 留空。`_headers` 在 Pages 与 Netlify 都生效；Vercel 要改用 `vercel.json`。

域名解析到托管方即可。大陆访问与备案按域名再定。

## 换素材

不改 HTML。按 `assets/README.md` 的编号把文件丢进 `assets/`，刷新就出现；没放的位置还是那块带说明的格，页面不会破版。

## 上线前必须做的四件事

1. **素材到齐**（`assets/README.md` 那张表，26 件）。手机那三张要等 `jfen/responsive-v2` 合进 master 再拍。
2. **换掉尾屏的联系方式**：`index.html` 搜 `demo@example.com` 与 `+8600000000000`，还有二维码那个占位块（spec §10 第 16 条）。
3. **重核底座三个数字**：660 / 10,134 / 122 是 2026-09-20 在 master 上数的，上线当天再数一遍（命令写在 spec §4.15）。
4. **页脚 © 主体**：现在是「© 2026 灵睿 LinkSight」占位（spec D3）。

## 验收

按 spec §9 那 13 条走。最容易坏的三处：

- 钉住的 ScrollTrigger 必须**先于**其余触发器创建，否则导航高亮与上浮会提前几千像素触发（`main.js` 里 `if(c.desk){ before(); chain(); ... }` 那一行在 `navSpy()` 之前，别调顺序）。
- 系统开「减少动态效果」时页面不钉住、不位移，全部终态可读（`body` 默认就带 `static final`，桌面档才摘掉）。
- 390 宽无横向溢出；手机章三块画面比例 1440 : 768 : 390，竖排档 `flex-grow` 必须关掉。
