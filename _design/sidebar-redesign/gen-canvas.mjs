// gen-canvas.mjs — generates .dc.html artboards for the sidebar redesign canvas.
// 用法：node gen-canvas.mjs → 写出 *.dc.html + canvas.json；再用 Claude Design 的 seed-canvas.mjs 组装发布。
// 发布版：https://claude.ai/code/artifact/521bb00c-d981-4e55-8685-5ca7fe8834f7（2026-09-03）
// Pixel values lifted from frontend/src/styles/tokens.css, components/shell/*.vue,
// components/ds/SidebarNav.vue and docs/design/DESIGN-FIDELITY.md §一/§二.
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
// icons.json: lucide 0.468 图标 body（由 frontend/node_modules/lucide-vue-next 提取）；同目录优先
const ICONS = fs.existsSync(path.join(OUT, 'icons.json')) ? path.join(OUT, 'icons.json') : path.join(OUT, '..', 'icons.json')
const I = JSON.parse(fs.readFileSync(ICONS, 'utf8'))

// ── tokens (resolved values) ──
const T = {
  ink900: 'rgb(28,28,28)', ink700: 'rgba(28,28,28,0.8)', ink500: 'rgba(28,28,28,0.4)',
  ink300: 'rgba(28,28,28,0.2)', ink100: 'rgba(28,28,28,0.1)', ink050: 'rgba(28,28,28,0.05)',
  muted: 'rgba(28,28,28,0.62)', disabled: 'rgba(28,28,28,0.2)',
  white: '#fff', card: 'rgb(249,249,250)', sunken: 'rgb(245,245,246)', overlay: 'rgba(255,255,255,0.9)',
  blue: 'oklch(0.55 0.115 250)', orange: 'oklch(0.54 0.115 62)', red: 'oklch(0.56 0.150 27)', green: 'oklch(0.58 0.130 150)',
  brandBlue: 'rgb(76,152,253)', brandDeep: 'rgb(31,95,191)',
  sans: '"Roboto Mono Digits", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif',
  mono: '"Roboto Mono", ui-monospace, "SF Mono", Menlo, monospace',
  shadowPop: '0 8px 28px rgba(28,28,28,0.12)',
}

export function icon(name, size = 16, color = 'currentColor', extra = '') {
  const body = I[name]
  if (!body) throw new Error('missing icon ' + name)
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;display:block;${extra}">${body}</svg>`
}

// ── FP_NAV (verbatim from frontend/src/nav/fpNav.ts) ──
export const FP_NAV = [
  { id: 'data', label: '数据中心', short: '数据', icon: 'database', home: 'data-home', sections: [
    { items: [['data-home', '数据中心首页', 'layout-dashboard']] },
    { title: '主数据', items: [['buildings', '楼栋管理', 'building-2'], ['tenants', '租户管理', 'users']] },
    { title: '出账链 · 应收派生', items: [['contracts', '合同管理', 'file-text'], ['params', '计费参数', 'sliders-horizontal'], ['meters', '园区抄表', 'gauge'], ['alloc', '公共电核算', 'share-2'], ['alloc-loss', '楼栋损耗', 'trending-down'], ['bill-notices', '催缴单', 'file-check-2']] },
    { title: '实际数 · 事后录入', items: [['ledger', '月度台账', 'book-open'], ['pv-income', '附表6 光伏发电', 'sun'], ['car-charging', '附表7 汽车充电桩', 'car'], ['ebike-charging', '附表8 电动车充电桩', 'bike'], ['sales-income', '附表10 销售收入', 'coins'], ['elec-cost', '附表11 电费成本', 'zap'], ['salary', '附表12 工资明细', 'wallet'], ['utilities', '办公·三期水电', 'plug'], ['bank-flow', '银行流水', 'landmark']] },
    { items: [['import', '导入中心', 'upload']] },
  ] },
  { id: 'reports', label: '账簿与报表', short: '报表', icon: 'book-marked', home: 'reports-home', sections: [
    { items: [['reports-home', '报表中心', 'layout-dashboard']] },
    { title: '三大报表', items: [['income-statement', '利润表', 'trending-up'], ['balance-sheet', '资产负债表', 'scale'], ['trial-balance', '科目余额表', 'table-2']] },
    { title: '损益附表', items: [['rent-pnl', '附表1 租金损益', 'home'], ['elec-pnl', '附表2 用电损益', 'zap'], ['water-pnl', '附表3 用水损益', 'droplets'], ['ops-pnl', '附表4 运管损益', 'wrench'], ['expense-pnl', '附表5 费用支出', 'banknote']] },
    { items: [['reconciliation', '收入核对', 'git-compare']] },
  ] },
  { id: 'analysis', label: '经营分析', short: '分析', icon: 'pie-chart', home: 'cockpit', sections: [
    { items: [['cockpit', '经营驾驶舱', 'gauge']] },
    { title: '园区维度', items: [['park', '出租与楼栋', 'building-2'], ['park-energy', '园区能耗', 'zap']] },
    { title: '租户维度', items: [['tenant-energy', '用能与缴费', 'activity'], ['tenant-portfolio', '结构与续约', 'users']] },
    { title: '管理公司维度', items: [['fin-pnl', '利润表分析', 'bar-chart-3'], ['fin-balance', '资产负债分析', 'scale'], ['fin-cashflow', '现金流量分析', 'wallet'], ['fin-expense', '费用与报销', 'receipt']] },
    { title: '专题分析', items: [['churn', '租户流失预警', 'siren'], ['expiry', '到期墙与续约', 'calendar-clock'], ['breakeven', '盈亏平衡与敏感性', 'scale-3d'], ['pnl-analysis', '损益附表分析', 'layers'], ['budget', '预算对比', 'target'], ['pv-roi', '光伏投资回收', 'sun'], ['pv-meter-analysis', '光伏分栋分析', 'sun'], ['elec-analysis', '电费成本分析', 'zap'], ['charging-analysis', '充电桩分析', 'plug']] },
    { title: '监控', items: [['anomaly', '异常提醒中心', 'bell-ring']] },
  ] },
  { id: 'system', label: '系统管理', short: '系统', icon: 'settings', home: 'sys-users', sections: [
    { items: [['sys-users', '用户管理', 'users'], ['sys-roles', '角色权限', 'shield-check'], ['sys-logs', '操作日志', 'scroll-text']] },
  ] },
]

// ── shared CSS (helmet) ──
export const BASE_CSS = `
  body { margin:0; font-family:${T.sans}; color:${T.ink900}; background:#fff; -webkit-font-smoothing:antialiased; }
  a { color:${T.blue}; } a:hover { color:${T.brandDeep}; }
  .num { font-family:${T.mono}; }
  /* rail */
  .fp-rail { width:66px; flex:0 0 66px; display:flex; flex-direction:column; align-items:center; padding:14px 9px; gap:5px; box-sizing:border-box; background:${T.sunken}; }
  .fp-rail-mark { width:40px; height:40px; border-radius:13px; background:#fff; border:1px solid ${T.ink100}; display:grid; place-items:center; flex:0 0 auto; }
  .fp-railsep { width:30px; height:1px; background:${T.ink100}; margin:9px 0 7px; flex:0 0 auto; }
  .fp-rail-btn { width:48px; border:none; background:transparent; color:${T.muted}; border-radius:15px; padding:9px 0 7px; display:flex; flex-direction:column; align-items:center; gap:5px; font-family:${T.sans}; font-size:10.5px; font-weight:500; flex:0 0 auto; }
  .fp-rail-btn.on { background:${T.ink900}; color:#fff; box-shadow:0 6px 16px rgba(28,28,28,0.2); }
  .fp-rail-foot { margin-top:auto; display:flex; flex-direction:column; align-items:center; gap:11px; padding-top:10px; }
  .fp-rail-cmd { width:40px; height:40px; border-radius:13px; border:1px solid ${T.ink100}; background:#fff; color:${T.ink700}; display:grid; place-items:center; }
  .fp-avatar { width:32px; height:32px; border-radius:50%; background:${T.brandBlue}; color:#fff; display:grid; place-items:center; font-size:12px; font-weight:600; }
  /* panel */
  .fp-panel { width:234px; flex:0 0 234px; display:flex; flex-direction:column; gap:14px; padding:18px 14px 14px; box-sizing:border-box; }
  .fp-panel-hdr { display:flex; align-items:center; gap:9px; padding:0 6px; color:${T.ink900}; height:24px; }
  .fp-panel-hdr .nm { font-size:16px; font-weight:600; letter-spacing:-0.01em; white-space:nowrap; }
  .fp-panel-div { height:1px; background:${T.ink100}; margin:0 -14px; }
  .fp-nav { display:flex; flex-direction:column; gap:16px; }
  .fp-sec { display:flex; flex-direction:column; gap:2px; }
  .fp-gt { font:400 12px/18px ${T.sans}; color:${T.muted}; padding:6px 12px; }
  .fp-row { position:relative; display:flex; align-items:center; gap:8px; height:34px; padding:0 12px; border-radius:8px; font-size:14px; font-weight:500; color:${T.ink700}; box-sizing:border-box; white-space:nowrap; }
  .fp-row .lb { flex:1; overflow:hidden; text-overflow:ellipsis; }
  .fp-row.on { background:${T.ink050}; color:${T.ink900}; }
  .fp-row.on::before { content:''; position:absolute; left:0; top:8px; bottom:8px; width:3px; border-radius:3px; background:${T.ink900}; }
  .fp-dot { position:absolute; right:10px; top:50%; margin-top:-3px; width:6px; height:6px; border-radius:50%; background:${T.orange}; }
  /* shell */
  .fp-stage { display:flex; padding:12px; gap:12px; box-sizing:border-box; background:#fff; }
  .fp-nav-card { flex:0 0 auto; background:#fff; border:1px solid ${T.ink100}; border-radius:24px; overflow:hidden; display:flex; }
  .fp-vdiv { flex:0 0 1px; width:1px; background:${T.ink100}; }
  .fp-main-card { flex:1; min-width:0; display:flex; flex-direction:column; background:#fff; border:1px solid ${T.ink100}; border-radius:24px; overflow:hidden; position:relative; }
  .fp-tabstrip { height:44px; padding:0 8px; background:${T.card}; display:flex; align-items:center; gap:4px; box-sizing:border-box; }
  .fp-tab { height:32px; padding:0 6px 0 11px; border-radius:8px; display:flex; align-items:center; gap:7px; font-size:12.5px; line-height:20px; color:${T.ink700}; }
  .fp-tab.on { background:#fff; color:${T.ink900}; box-shadow:0 1px 3px rgba(28,28,28,0.06), 0 1px 2px rgba(28,28,28,0.04); }
  .fp-tab.prev { font-style:italic; }
  .fp-tab-x { width:20px; height:20px; border-radius:6px; display:grid; place-items:center; color:${T.muted}; }
  .fp-tab-add { height:28px; width:28px; border-radius:8px; display:grid; place-items:center; color:${T.muted}; }
  .fp-toolbar { height:48px; display:flex; align-items:center; gap:8px; padding:0 16px; border-bottom:1px solid ${T.ink100}; background:${T.overlay}; box-sizing:border-box; }
  .fp-ib { width:32px; height:32px; border-radius:8px; display:grid; place-items:center; color:${T.ink700}; }
  .fp-crumb { display:flex; align-items:center; gap:7px; margin-left:6px; font-size:14px; }
  .fp-crumb .g { color:${T.muted}; } .fp-crumb .s { color:${T.disabled}; } .fp-crumb .p { font-weight:500; color:${T.ink900}; }
  .fp-tb-right { margin-left:auto; display:flex; align-items:center; gap:8px; }
  .fp-search { display:flex; align-items:center; gap:8px; height:34px; padding:0 8px 0 12px; border-radius:999px; border:1px solid ${T.ink100}; background:${T.card}; color:${T.muted}; min-width:200px; font-size:13px; box-sizing:border-box; }
  .fp-kbd { font-family:${T.mono}; font-size:10.5px; padding:1px 6px; border:1px solid ${T.ink100}; border-radius:5px; color:${T.muted}; background:#fff; }
  .fp-presence { width:130px; height:32px; border-radius:999px; border:1px solid ${T.ink100}; background:#fff; display:flex; align-items:center; padding:0 6px; gap:4px; box-sizing:border-box; }
  .fp-content { flex:1; padding:24px; box-sizing:border-box; }
  /* callouts */
  .co { position:absolute; width:18px; height:18px; border-radius:50%; background:${T.red}; color:#fff; font:600 11px/18px ${T.mono}; text-align:center; box-shadow:0 0 0 2px #fff; z-index:5; }
  .legend { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px 18px; padding:16px 24px 20px; font-size:12.5px; line-height:18px; color:${T.ink700}; }
  .legend .it { display:flex; gap:8px; align-items:flex-start; }
  .legend .it b { flex:0 0 18px; height:18px; border-radius:50%; background:${T.red}; color:#fff; font:600 11px/18px ${T.mono}; text-align:center; }
  .cap { font-size:11.5px; color:${T.muted}; }
  .tag { display:inline-block; font-size:11px; padding:1px 7px; border-radius:999px; background:${T.sunken}; color:${T.ink700}; }
`

function wrap(title, bodyHtml, extraCss = '') {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>${title}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600&display=swap">
  <style>${BASE_CSS}${extraCss}</style>
</helmet>
${bodyHtml}
</x-dc>
</body>
</html>`
}

// ── building blocks ──
export function rail(activeId, opts = {}) {
  const layers = (opts.layers || FP_NAV).filter(L => !opts.hide || !opts.hide.includes(L.id))
  return `<div class="fp-rail">
    <div class="fp-rail-mark"><svg width="22" height="22" viewBox="0 0 40 40" fill="none"><rect x="3" y="20" width="9" height="16" rx="2" fill="#A8CDF0"/><rect x="15.5" y="12" width="9" height="24" rx="2" fill="#4C98FD"/><rect x="28" y="4" width="9" height="32" rx="2" fill="#1F5FBF"/></svg></div>
    <div class="fp-railsep"></div>
    ${layers.map(L => `<div class="fp-rail-btn${L.id === activeId ? ' on' : ''}">${icon(L.icon, 20)}<span>${L.short}</span></div>`).join('')}
    <div class="fp-rail-foot">
      <div class="fp-rail-cmd">${icon('command', 16)}</div>
      <div class="fp-avatar">周</div>
    </div>
  </div>`
}

export function panelBody(layer, activeValue, dots = []) {
  return `<div class="fp-nav">${layer.sections.map(s => `<div class="fp-sec">${s.title ? `<div class="fp-gt">${s.title}</div>` : ''}${s.items.map(([v, l, ic]) => `<div class="fp-row${v === activeValue ? ' on' : ''}">${icon(ic, 16)}<span class="lb">${l}</span>${dots.includes(v) ? '<span class="fp-dot"></span>' : ''}</div>`).join('')}</div>`).join('')}</div>`
}

export function panel(layer, activeValue, dots = [], style = '') {
  return `<div class="fp-panel" style="${style}">
    <div class="fp-panel-hdr">${icon(layer.icon, 18)}<span class="nm">${layer.label}</span></div>
    <div class="fp-panel-div"></div>
    ${panelBody(layer, activeValue, dots)}
  </div>`
}

export function tabstrip(tabs) {
  return `<div class="fp-tabstrip">${tabs.map(t => `<div class="fp-tab${t.on ? ' on' : ''}${t.prev ? ' prev' : ''}">${icon(t.icon, 14)}<span>${t.label}</span><span class="fp-tab-x">${icon('x', 12)}</span></div>`).join('')}<div class="fp-tab-add">${icon('plus', 14)}</div></div>`
}

export function toolbar(group, page, opts = {}) {
  return `<div class="fp-toolbar">
    <div class="fp-ib">${icon('panel-left', 16)}</div>
    <div class="fp-ib">${icon('star', 16)}</div>
    <div class="fp-crumb"><span class="g">${group}</span><span class="s">/</span><span class="p">${page}</span></div>
    <div class="fp-tb-right">
      <div class="fp-presence"><div class="fp-avatar" style="width:22px;height:22px;font-size:10px;background:${T.brandDeep}">李</div><div class="fp-avatar" style="width:22px;height:22px;font-size:10px;margin-left:-8px;background:${T.orange}">王</div><span class="cap" style="margin-left:6px">2 人在线</span></div>
      <div class="fp-search">${icon('search', 15)}<span style="flex:1">${opts.searchHint || '搜索页面 / 租户 / 凭证…'}</span><span class="fp-kbd">Ctrl K</span></div>
      ${opts.noSun ? '' : `<div class="fp-ib">${icon('sun', 16)}</div>`}
      <div class="fp-ib" style="position:relative">${icon('bell', 16)}<span style="position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:${T.red};color:#fff;font:600 9.5px/14px ${T.mono};text-align:center;box-shadow:0 0 0 1.5px #fff">1</span></div>
    </div>
  </div>`
}

// ═══════════════════════════════════════════════════════════════
// Artboard 1 — 现状 · 1366×620 浏览器内视口，数据中心层，激活「月度台账」
// ═══════════════════════════════════════════════════════════════
function currentShell() {
  const data = FP_NAV[0]
  const VH = 620 // 1366×768 屏幕减系统栏与浏览器铬后的内视口（PV-ANALYSIS-SPEC §6.1 同口径）
  const body = `
  <div style="width:1366px;background:#fff;display:flex;flex-direction:column;">
    <div class="fp-stage" style="width:1366px;height:${VH}px;position:relative;">
      <div class="fp-nav-card" style="height:${VH - 24}px;position:relative;">
        ${rail('data')}
        <div class="fp-vdiv"></div>
        <div style="position:relative;overflow:hidden;height:${VH - 26}px;width:234px;">
          ${panel(data, 'ledger', ['params', 'meters', 'alloc'])}
          <div style="position:absolute;right:2px;top:20px;width:6px;height:${Math.round((VH - 26) * (VH - 26) / 913)}px;border-radius:999px;background:${T.ink300}"></div>
        </div>
        <span class="co" style="left:170px;top:${VH - 60}px">1</span>
        <span class="co" style="left:222px;top:154px">2</span>
        <span class="co" style="left:222px;top:250px">6</span>
        <span class="co" style="left:52px;top:196px">7</span>
        <span class="co" style="left:52px;top:26px">7</span>
      </div>
      <div class="fp-main-card" style="height:${VH - 24}px;">
        ${tabstrip([{ icon: 'layout-dashboard', label: '数据中心首页' }, { icon: 'book-open', label: '月度台账', on: true, prev: true }])}
        ${toolbar('数据中心', '月度台账')}
        <div class="fp-content" style="display:flex;gap:16px;">
          <div style="width:208px;flex:0 0 208px;border:1px solid ${T.ink100};border-radius:16px;padding:12px;box-sizing:border-box;">
            <div class="cap" style="padding:0 6px 8px">账册</div>
            ${['A 公司', 'B 公司', 'C 公司', 'D 公司', 'E 公司', 'F 公司'].map(c => `<div class="fp-row" style="height:32px;font-size:13px;">${icon('book-open', 14)}<span class="lb">${c}</span></div>`).join('')}
          </div>
          <div style="flex:1;border:1px dashed ${T.ink300};border-radius:16px;display:grid;place-items:center;color:${T.muted};font-size:14px;">从左侧选择账册 — 每次从侧栏进来都是这一屏</div>
        </div>
        <span class="co" style="left:74px;top:58px">3</span>
        <span class="co" style="right:236px;top:58px">4</span>
        <span class="co" style="right:72px;top:58px">3</span>
        <span class="co" style="left:142px;top:12px">9</span>
        <span class="co" style="left:290px;top:88px">5</span>
      </div>
    </div>
    <div class="legend">
      <div class="it"><b>1</b><span>数据中心面板需 <span class="num">913px</span>，可视仅 <span class="num">~509px</span>：「附表6」起 9 行在折叠线下，激活时不 scrollIntoView。分析层更高（<span class="num">987px</span>）。</span></div>
      <div class="it"><b>2</b><span>分组标题不可折叠、不可点、不进 Ctrl-K 搜索（搜「出账链」零结果）。</span></div>
      <div class="it"><b>3</b><span>「收藏本页」「浅色/深色模式」两个按钮无 handler，是死按钮。</span></div>
      <div class="it"><b>4</b><span>搜索框承诺「租户 / 凭证」，命令面板只按页名与层名子串匹配。</span></div>
      <div class="it"><b>5</b><span>侧栏点击 = openFresh 全新重建：年 / 月 / 账册全清；点当前项也重建。首页「去处理」不带月。</span></div>
      <div class="it"><b>6</b><span>在场点只覆盖 20 项、只在 title 里解释「谁 / 为什么三点同亮」；页签条没有同款点。</span></div>
      <div class="it"><b>7</b><span>rail 点当前层也跳回层首页；logo 不可点；账号菜单把 6 个角色压成「只读 / 管理员(可写)」两态。</span></div>
      <div class="it"><b>8</b><span>「银行流水」是占位页，对所有角色常驻可见（面板内第 18 行，折叠线下）。</span></div>
      <div class="it"><b>9</b><span>页签只显屏名，同屏不同期 / 公司无法并排；preview 页签被任意导航静默顶替。</span></div>
    </div>
  </div>`
  return wrap('现状 · 数据中心层', body)
}

// ═══════════════════════════════════════════════════════════════
// Artboard 2 — 现状 · 三层面板真实高度 vs 可视高度
// ═══════════════════════════════════════════════════════════════
function currentPanels() {
  const foldY = 26 + 509 // stage/card top offset + usable nav area (620 inner viewport)
  const col = (L, active, h, note) => `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:12.5px;color:${T.ink700};display:flex;justify-content:space-between;width:234px;"><span>${L.label}</span><span class="num" style="color:${h > 560 ? T.red : T.green}">${h}px</span></div>
      <div style="width:236px;border:1px solid ${T.ink100};border-radius:16px;overflow:hidden;background:#fff;">${panel(L, active)}</div>
      <div class="cap" style="width:234px;">${note}</div>
    </div>`
  const body = `
  <div style="width:820px;padding:24px;box-sizing:border-box;background:#fff;position:relative;">
    <div style="font-size:16px;font-weight:600;margin-bottom:4px;">面板真实高度 vs 一屏可视高度</div>
    <div class="cap" style="margin-bottom:18px;">1366×768 办公机：浏览器内视口 ≈ <span class="num">620px</span> → 导航卡 <span class="num">594px</span> → 面板内容区 <span class="num">562px</span> → 减头 24 / 间隙 28 / 分割线 1 = 导航区 ≈ <span class="num">509px</span>。行 34 · 组间 16 · 组标题 30 · 项间 2。</div>
    <div style="display:flex;gap:28px;align-items:flex-start;position:relative;">
      ${col(FP_NAV[0], 'ledger', 913, '19 项 / 5 组。「实际数」9 项一组，与「专题分析」并列最长。')}
      ${col(FP_NAV[2], 'anomaly', 987, '19 项 / 7 组。「监控 · 异常提醒中心」在最底，高管周看却排最末。')}
      ${col(FP_NAV[1], 'income-statement', 545, '10 项 / 4 组。也装不下：「收入核对」在线下。')}
      <div style="position:absolute;left:-8px;right:-8px;top:607px;height:0;border-top:2px dashed ${T.red};pointer-events:none;"></div>
      <div style="position:absolute;right:-8px;top:611px;font:600 11px/14px ${T.mono};color:${T.red};background:#fff;padding:0 4px;">导航区折叠线 ≈ 509px</div>
    </div>
  </div>`
  return wrap('现状 · 面板溢出', body)
}

// ═══════════════════════════════════════════════════════════════
// 推荐方案的导航树（fpNav 改动后；value/label/icon 逐字沿用，只动分组）
// ═══════════════════════════════════════════════════════════════
const NEW_NAV = [
  { id: 'data', label: '数据中心', short: '数据', icon: 'database', sections: [
    { items: [['data-home', '本月出账', 'calendar-check']] },
    { title: '档案', items: [['buildings', '楼栋管理', 'building-2'], ['tenants', '租户管理', 'users'], ['contracts', '合同管理', 'file-text']] },
    { title: '出账 · 每月工序', items: [['params', '计费参数', 'sliders-horizontal'], ['meters', '园区抄表', 'gauge'], ['alloc', '公共电核算', 'share-2'], ['alloc-loss', '楼栋损耗', 'trending-down'], ['bill-notices', '催缴单', 'file-check-2']] },
    { title: '记账 · 按月', items: [['ledger', '月度台账', 'book-open'], ['sales-income', '附表10 销售收入', 'coins'], ['salary', '附表12 工资明细', 'wallet']] },
    { title: '记账 · 按年', items: [['pv-income', '附表6 光伏发电', 'sun'], ['car-charging', '附表7 汽车充电桩', 'car'], ['ebike-charging', '附表8 电动车充电桩', 'bike'], ['elec-cost', '附表11 电费成本', 'zap'], ['utilities', '办公·三期水电', 'plug']] },
    { items: [['import', '导入中心', 'upload']] },
  ] },
  { id: 'reports', label: '账簿与报表', short: '报表', icon: 'book-marked', sections: [
    { items: [['reports-home', '报表中心', 'layout-dashboard']] },
    { title: '三大报表', items: [['income-statement', '利润表', 'trending-up'], ['balance-sheet', '资产负债表', 'scale'], ['trial-balance', '科目余额表', 'table-2']] },
    { title: '损益附表', items: [['rent-pnl', '附表1 租金损益', 'home'], ['elec-pnl', '附表2 用电损益', 'zap'], ['water-pnl', '附表3 用水损益', 'droplets'], ['ops-pnl', '附表4 运管损益', 'wrench'], ['expense-pnl', '附表5 费用支出', 'banknote']] },
    { items: [['reconciliation', '收入核对', 'git-compare']] },
  ] },
  { id: 'analysis', label: '经营分析', short: '分析', icon: 'pie-chart', sections: [
    { items: [['cockpit', '经营驾驶舱', 'gauge'], ['anomaly', '异常提醒中心', 'bell-ring']] },
    { title: '园区维度', items: [['park', '出租与楼栋', 'building-2'], ['park-energy', '园区能耗', 'zap']] },
    { title: '租户维度', items: [['tenant-energy', '用能与缴费', 'activity'], ['tenant-portfolio', '结构与续约', 'users']] },
    { title: '管理公司维度', items: [['fin-pnl', '利润表分析', 'bar-chart-3'], ['fin-balance', '资产负债分析', 'scale'], ['fin-cashflow', '现金流量分析', 'wallet'], ['fin-expense', '费用与报销', 'receipt']] },
    { title: '经营专题', items: [['churn', '租户流失预警', 'siren'], ['expiry', '到期墙与续约', 'calendar-clock'], ['breakeven', '盈亏平衡与敏感性', 'scale-3d'], ['budget', '预算对比', 'target'], ['pnl-analysis', '损益附表分析', 'layers']] },
    { title: '能源专题', items: [['pv-roi', '光伏投资回收', 'sun'], ['pv-meter-analysis', '光伏分栋分析', 'table-2'], ['elec-analysis', '电费成本分析', 'zap'], ['charging-analysis', '充电桩分析', 'plug']] },
  ] },
]

// 折叠面板：open = 展开的组标题集合；dots = 有人编辑的 value
export function panel2(layer, activeValue, open = [], dots = [], style = '') {
  const secs = layer.sections.map(s => {
    const isOpen = !s.title || open.includes(s.title)
    const childDot = s.title && !isOpen && s.items.some(([v]) => dots.includes(v))
    const title = s.title ? `<div class="fp-gt fp-gt2">${s.title}<span class="fp-gt-n">${s.items.length}</span>${icon(isOpen ? 'chevron-down' : 'chevron-right', 14, T.muted, 'position:absolute;right:12px;top:8px')}${childDot ? '<span class="fp-dot" style="right:34px"></span>' : ''}</div>` : ''
    const rows = isOpen ? s.items.map(([v, l, ic]) => `<div class="fp-row${v === activeValue ? ' on' : ''}">${icon(ic, 16)}<span class="lb">${l}</span>${dots.includes(v) ? '<span class="fp-dot"></span>' : ''}</div>`).join('') : ''
    return `<div class="fp-sec">${title}${rows}</div>`
  }).join('')
  return `<div class="fp-panel" style="${style}">
    <div class="fp-panel-hdr">${icon(layer.icon, 18)}<span class="nm">${layer.label}</span></div>
    <div class="fp-panel-div"></div>
    <div class="fp-nav">${secs}</div>
  </div>`
}
// 导航区高度（不含面板头 71 与底 padding 14）
function navHeight(layer, open) {
  let h = 0
  layer.sections.forEach((s, i) => {
    const isOpen = !s.title || open.includes(s.title)
    h += (s.title ? 30 : 0) + (isOpen ? s.items.length * 34 + (s.items.length - 1) * 2 + (s.title ? 2 : 0) : 0) + (i ? 16 : 0)
  })
  return h
}

const CSS2 = `
  .fp-gt2 { position:relative; cursor:pointer; padding-right:32px; }
  .fp-gt-n { margin-left:6px; font-family:${T.mono}; font-size:10.5px; color:${T.ink500}; }
  .fp-tab2 { width:148px; flex:0 0 148px; height:32px; padding:0 6px 0 11px; border-radius:8px; display:flex; align-items:center; gap:7px; font-size:12.5px; color:${T.ink700}; box-sizing:border-box; }
  .fp-tab2 .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fp-tab2.on { background:#fff; color:${T.ink900}; box-shadow:0 1px 3px rgba(28,28,28,0.06), 0 1px 2px rgba(28,28,28,0.04); }
  .fp-ctx { width:132px; flex:0 0 132px; height:26px; border-radius:999px; background:${T.sunken}; color:${T.ink700}; font-size:12px; display:flex; align-items:center; gap:6px; padding:0 10px; box-sizing:border-box; margin-left:8px; white-space:nowrap; }
  .fp-ctx .num { font-size:12px; }
  .ann { font-size:12.5px; line-height:19px; color:${T.ink700}; }
  .ann b { color:${T.ink900}; font-weight:600; }
  .ann li { margin:0 0 8px 0; }
  .h { font-size:16px; font-weight:600; color:${T.ink900}; letter-spacing:-0.01em; }
  .sub { font-size:12px; color:${T.muted}; }
  /* hub */
  .mc { width:76px; height:72px; border:1px solid ${T.ink100}; border-radius:12px; padding:8px 8px 6px; box-sizing:border-box; display:flex; flex-direction:column; justify-content:space-between; position:relative; background:#fff; }
  .mc.cur { border:2px solid ${T.ink900}; padding:7px 7px 5px; }
  .mc.stale { background:oklch(0.97 0.03 62); }
  .mc.empty { background:${T.sunken}; border-color:transparent; color:${T.muted}; }
  .mc .m { font-family:${T.mono}; font-size:12px; font-weight:600; }
  .pips { display:flex; gap:4px; }
  .pip { width:9px; height:9px; border-radius:50%; background:${T.ink100}; }
  .pip.d { background:${T.green}; }
  .pip.w { background:${T.orange}; }
  .lockb { position:absolute; right:6px; top:6px; color:${T.orange}; }
  .sup { height:32px; border-radius:10px; background:${T.sunken}; display:flex; align-items:center; gap:10px; padding:0 12px; font-size:12.5px; color:${T.ink700}; box-sizing:border-box; }
  .chip { display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 9px; border-radius:999px; background:#fff; border:1px solid ${T.ink100}; font-size:12px; color:${T.ink700}; white-space:nowrap; }
  .chip.ok { border-color:oklch(0.85 0.08 150); color:${T.green}; }
  .chip.todo { color:${T.muted}; border-style:dashed; }
  .chip.ent { background:${T.sunken}; color:${T.ink700}; border-color:transparent; }
  .chip.pend { border-color:oklch(0.85 0.08 62); color:${T.orange}; }
  .chip.ret { border-color:oklch(0.85 0.08 27); color:${T.red}; }
  .chip.me { background:${T.ink900}; color:#fff; border-color:${T.ink900}; }
  .rv { flex:0 0 auto; display:inline-flex; align-items:center; gap:4px; height:20px; padding:0 8px; border-radius:999px; font-size:11.5px; white-space:nowrap; }
  .rv.ok { background:oklch(0.95 0.04 150); color:${T.green}; }
  .rv.pend { background:oklch(0.96 0.04 62); color:${T.orange}; }
  .rv.none { background:${T.sunken}; color:${T.muted}; }
  .rv.ret { background:oklch(0.96 0.04 27); color:${T.red}; }
  .rv.na { color:${T.disabled}; }
  .btn { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 12px; border-radius:8px; font-size:12.5px; font-weight:500; border:1px solid ${T.ink100}; background:#fff; color:${T.ink900}; white-space:nowrap; flex:0 0 auto; }
  .btn.solid { background:${T.ink900}; color:#fff; border-color:${T.ink900}; }
  .btn.dis { color:${T.disabled}; background:${T.sunken}; border-color:transparent; }
  .box { border:1px solid ${T.ink100}; border-radius:14px; padding:14px 16px; background:#fff; }
  .sm { width:118px; height:56px; border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; font-size:13px; font-weight:600; border:1px solid ${T.ink100}; }
  .arrow { display:flex; flex-direction:column; align-items:center; gap:2px; font-size:11px; color:${T.muted}; width:120px; }
  .arrow .ln { width:100%; height:0; border-top:2px solid ${T.ink300}; position:relative; }
  .arrow .ln::after { content:''; position:absolute; right:-1px; top:-5px; border:5px solid transparent; border-left:7px solid ${T.ink300}; }
  .col { flex:1; min-width:0; border:1px solid ${T.ink100}; border-radius:16px; overflow:hidden; }
  .col .ch { height:36px; display:flex; align-items:center; gap:8px; padding:0 14px; font-size:13px; font-weight:600; background:${T.card}; border-bottom:1px solid ${T.ink100}; }
  .crow { height:38px; display:flex; align-items:center; gap:10px; padding:0 14px; border-bottom:1px solid ${T.ink050}; font-size:13px; color:${T.ink900}; }
  .crow:last-child { border-bottom:none; }
  .crow .nm { width:112px; flex:0 0 112px; font-weight:500; white-space:nowrap; }
  .crow .dt { flex:1; min-width:0; color:${T.muted}; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .crow .st { flex:0 0 auto; display:flex; align-items:center; gap:6px; font-size:12px; }
  .crow.cur { background:oklch(0.97 0.02 250); }
  .crow.dis { color:${T.disabled}; }
  .crow.dis .nm { color:${T.disabled}; }
  .lo { border:1px dashed ${T.ink300}; border-radius:14px; padding:14px 16px; background:#fff; }
  .lo h4 { margin:0 0 6px; font-size:14px; }
  .lo p { margin:0 0 6px; font-size:12px; line-height:18px; color:${T.ink700}; }
  .score { font-family:${T.mono}; font-size:22px; font-weight:600; }
`

// ═══════════════════════════════════════════════════════════════
// Artboard 3 — Main · 推荐方案：三层面板默认态 + 语义
// ═══════════════════════════════════════════════════════════════
function mainPanels() {
  const D = NEW_NAV[0], R = NEW_NAV[1], A = NEW_NAV[2]
  const dOpen = ['出账 · 每月工序'], rOpen = ['三大报表'], aOpen = []
  const colBox = (L, active, open, dots, note) => {
    const h = navHeight(L, open)
    return `<div style="display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;justify-content:space-between;width:234px;font-size:12.5px;color:${T.ink700}"><span>${L.label} · 默认态</span><span class="num" style="color:${h <= 500 ? T.green : T.red}">${h}px</span></div>
      <div style="width:236px;border:1px solid ${T.ink100};border-radius:16px;overflow:hidden;background:#fff;">${panel2(L, active, open, dots)}</div>
      <div class="cap" style="width:234px;">${note}</div>
    </div>`
  }
  const body = `
  <div style="width:1180px;padding:24px;box-sizing:border-box;background:#fff;">
    <div class="h">推荐方案 · 侧边栏三层默认态</div>
    <div class="sub" style="margin:4px 0 18px;">容器不动（轨 66 / 面板 234 / 行 34 / 组标题 30）；只重排内容、加折叠、修语义。预算 <span class="num">500px</span>（内视口 620 → 导航区 509）。</div>
    <div style="display:flex;gap:24px;align-items:flex-start;">
      ${colBox(D, 'data-home', dOpen, ['meters', 'alloc'], '5 组按动词：档案 / 出账 / 记账·月 / 记账·年 / 导入。合同移入档案；银行流水下架。折叠组标题行聚合子项在场点（档案 无、出账 有）。')}
      ${colBox(R, 'income-statement', rOpen, [], '结构不变。收入核对留在报表层（期间条与面包屑一致）；在「本月出账」清单里以出账列第 6 行出现。')}
      ${colBox(A, 'cockpit', aOpen, [], '「监控」组撤销，异常提醒中心升到第 2 行。「专题分析」9 项拆为经营 5 + 能源 4。带标题组全部手风琴。')}
      <div style="flex:1;min-width:0;">
        <div class="h" style="font-size:14px;margin-bottom:8px;">语义（对应 04 文档 §2.5）</div>
        <ul class="ann" style="padding-left:18px;margin:0;">
          <li><b>侧栏项 = 恢复现场</b>（open）；点当前项 no-op；Shift+点击 = 全新。今天是每次重建、丢年/月/册。</li>
          <li><b>轨层钮</b>：当前层 no-op；换层才 openFresh(home)。</li>
          <li><b>组标题可点折叠</b>，chevron absolute，30px 不变；路由变化只展开含当前屏的组，<b>不收回</b>用户手动展开的组（会话内记忆）。</li>
          <li><b>折叠组聚合在场点</b>：出账组收起时仍能看到「有人在改」。</li>
          <li><b>在场点</b>文案带期「李四 正在编辑 · 2024-02」，aria + 点按弹说明，触屏可达。</li>
          <li><b>一套期间深链</b>：<code>?p=YYYY-MM&amp;co=</code>；目标屏 onMounted + onReactivated 认领；首页/清单行 = 显式选月 pick。</li>
          <li><b>KeepAlive max 10 → 16</b>，覆盖专员月内 15 屏。</li>
          <li><b>navHeight.spec</b>：默认态与最坏单组展开 ≤ 500，塞 3 个假项应红。</li>
        </ul>
      </div>
    </div>
  </div>`
  return wrap('推荐方案 · 侧边栏', body, CSS2)
}

// ═══════════════════════════════════════════════════════════════
// Artboard 4 — Hub · 本月出账（数据层落地屏，1366×620）
// ═══════════════════════════════════════════════════════════════
function hubScreen() {
  const VH = 620
  const D = NEW_NAV[0]
  const months = [
    { m: '01', pips: 'dddd' }, { m: '02', pips: 'dddw', cur: true, lock: true }, { m: '03', pips: '', empty: true },
    ...['04', '05', '06', '07', '08', '09', '10', '11', '12'].map(m => ({ m, empty: true })),
  ]
  const cell = c => `<div class="mc${c.cur ? ' cur' : ''}${c.empty ? ' empty' : ''}"><span class="m">${c.m}<span style="font-weight:400;color:${T.muted}">月</span></span>${c.lock ? `<span class="lockb">${icon('lock', 12)}</span>` : ''}<div class="pips">${c.pips ? c.pips.split('').map(p => `<span class="pip ${p}"></span>`).join('') : '<span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span>'}</div></div>`
  const st = (kind, txt) => kind === 'ok' ? `<span class="st" style="color:${T.green}">${icon('circle-check', 14)}${txt}</span>`
    : kind === 'cur' ? `<span class="st" style="color:${T.blue}">${icon('play', 14)}${txt}</span>`
    : kind === 'warn' ? `<span class="st" style="color:${T.orange}">${icon('triangle-alert', 14)}${txt}</span>`
    : kind === 'lock' ? `<span class="st" style="color:${T.disabled}">${icon('lock', 14)}${txt}</span>`
    : `<span class="st" style="color:${T.muted}">${icon('circle-dashed', 14)}${txt}</span>`
  const rv = (k) => k === 'ok' ? `<span class="rv ok">${icon('shield-check', 11)}已审核 · 李审 03-05</span>`
    : k === 'pend' ? `<span class="rv pend">${icon('clock-3', 11)}待审核</span>`
    : k === 'ret' ? `<span class="rv ret">${icon('rotate-ccw', 11)}已退回</span>`
    : k === 'na' ? `<span class="rv na">不进审核</span>`
    : `<span class="rv none">未交审</span>`
  const row = (nm, dt, s, cls = '', r = 'none') => `<div class="crow ${cls}"><span class="nm">${nm}</span><span class="dt">${dt}</span>${s}${rv(r)}${icon('chevron-right', 14, T.ink300)}</div>`
  const chips = (arr) => arr.map(([t, k]) => `<span class="chip ${k}">${k === 'ok' ? icon('shield-check', 11) : k === 'pend' ? icon('clock-3', 11) : ''}${t}</span>`).join('')
  const body = `
  <div style="width:1366px;background:#fff;">
    <div class="fp-stage" style="width:1366px;height:${VH}px;position:relative;">
      <div class="fp-nav-card" style="height:${VH - 24}px;">
        ${rail('data')}
        <div class="fp-vdiv"></div>
        <div style="overflow:hidden;height:${VH - 26}px;width:234px;">${panel2(D, 'data-home', ['出账 · 每月工序'], ['ledger'])}</div>
      </div>
      <div class="fp-main-card" style="height:${VH - 24}px;">
        <div class="fp-tabstrip">
          <div class="fp-tab2 on">${icon('calendar-check', 14)}<span class="t">本月出账 · 2024-02</span><span class="fp-tab-x">${icon('x', 12)}</span></div>
          <div class="fp-tab2">${icon('gauge', 14)}<span class="t">园区抄表 · 2024-02</span><span class="fp-tab-x">${icon('x', 12)}</span></div>
          <div class="fp-tab-add">${icon('plus', 14)}</div>
        </div>
        <div class="fp-toolbar">
          <div class="fp-ib">${icon('panel-left', 16)}</div>
          <div class="fp-ib" title="固定为常驻页签">${icon('pin', 16)}</div>
          <div class="fp-crumb"><span class="g">数据中心</span><span class="s">/</span><span class="p">本月出账</span></div>
          <div class="fp-ctx">${icon('calendar', 13)}<span class="num">2024-02</span><span style="color:${T.muted}">· 全部公司</span></div>
          <div class="fp-tb-right">
            <div class="fp-presence"><div class="fp-avatar" style="width:22px;height:22px;font-size:10px;background:${T.brandDeep}">李</div><div class="fp-avatar" style="width:22px;height:22px;font-size:10px;margin-left:-8px;background:${T.orange}">王</div><span class="cap" style="margin-left:6px">2 人在线</span></div>
            <div class="fp-search">${icon('search', 15)}<span style="flex:1">搜索页面 / 分组…</span><span class="fp-kbd">Ctrl K</span></div>
            <div class="fp-ib" style="position:relative">${icon('bell', 16)}<span style="position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:${T.red};color:#fff;font:600 9.5px/14px ${T.mono};text-align:center;box-shadow:0 0 0 1.5px #fff">1</span></div>
          </div>
        </div>
        <div class="fp-content" style="display:flex;flex-direction:column;gap:10px;padding:20px 24px;">
          <div style="display:flex;align-items:baseline;gap:12px;">
            <span class="h" style="font-size:18px;">本月出账</span>
            <span class="sub"><span class="num">2024</span> 年 · 出账 <span class="num">4/5</span> · 记账 <span class="num">3/9</span></span>
            <span class="sub" style="margin-left:auto;">换年 ▾</span>
          </div>
          <div style="display:flex;gap:6px;">${months.map(cell).join('')}</div>
          <div class="sup">
            <span class="chip" style="background:${T.ink900};color:#fff;border-color:${T.ink900}">${icon('bell', 12, '#fff')}待批授权 <span class="num">1</span></span>
            <span style="color:${T.muted}">谁在编辑</span>
            <span class="chip">${icon('user', 12)}李四 · 月度台账 C · <span class="num">2024-02</span></span>
            <span style="margin-left:auto;color:${T.muted}">审核</span>
            <span class="chip pend">${icon('clock-3', 11)}待审核 <span class="num">2</span></span>
            <span class="chip ok">${icon('shield-check', 11)}已审核 <span class="num">6</span>/13</span>
          </div>
          <div style="display:flex;gap:16px;">
            <div class="col">
              <div class="ch">${icon('file-check-2', 15)}出账 · 每月工序<span style="margin-left:auto;font-weight:400;color:${T.muted};font-size:11.5px">审核态</span></div>
              ${row('计费参数', '本月电价 6/6 已录', st('ok', '已配'), '', 'ok')}
              ${row('园区抄表', '已抄 92 块', st('ok', '已抄'), '', 'pend')}
              ${row('公共电核算', '已生成 · 12 池', st('ok', '已生成'), '', 'ok')}
              ${row('楼栋损耗', '已生成', st('ok', '已生成'), '', 'ok')}
              ${row('催缴单', '102 户 · ¥2,474,138.88 · 66 户带警告', st('cur', '当前步'), 'cur', 'none')}
              ${row('收入核对', '差异 —', st('todo', '待核对'), '', 'na')}
              ${row('本月锁账', '全部行已审核后自动锁 · 6/13', st('lock', '未锁'), 'dis', 'na')}
            </div>
            <div class="col">
              <div class="ch">${icon('book-open', 15)}记账 · 台账与附表<span style="margin-left:auto;font-weight:400;color:${T.muted};font-size:11.5px">chip 色 = 审核态</span></div>
              <div class="crow"><span class="nm">月度台账</span><span class="dt" style="display:flex;gap:4px;overflow:visible">${chips([['A', 'ok'], ['B', 'pend'], ['C', 'ent'], ['D', 'todo'], ['E', 'todo'], ['F', 'todo']])}</span>${icon('chevron-right', 14, T.ink300)}</div>
              <div class="crow"><span class="nm">附表10 销售收入</span><span class="dt" style="display:flex;gap:4px;overflow:visible">${chips([['一期', 'ok'], ['二期', 'ent'], ['三期', 'todo'], ['四期', 'todo']])}</span>${icon('chevron-right', 14, T.ink300)}</div>
              ${row('附表12 工资', '未录入', st('todo', '未录'), '', 'none')}
              ${row('办公·三期水电', '附13 ✓ · 附14 未录', st('todo', '1/2'), '', 'ok')}
              ${row('附表6 光伏', '2024 年表 · 已录到 02 月', st('ok', '已录'), '', 'ok')}
              ${row('附表7/8 充电桩', '未录入', st('todo', '未录'), '', 'none')}
              ${row('附表11 电费成本', '已录入 · 审核员退回：3 月电价错', st('warn', '退回'), '', 'ret')}
              ${row('导入中心', '本月 3 次导入', `<span class="st" style="color:${T.ink700}">${icon('upload', 14)}去导入</span>`, '', 'na')}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="legend" style="grid-template-columns:repeat(4, minmax(0,1fr));">
      <div class="it"><b style="background:${T.ink900}">1</b><span>年份条复用 BookMonthMatrix：4 颗工序点（抄/摊/耗/催）不变，stale 走格底色；锁角标 = 该月有人持锁；全部行已审核 → ✓ 锁标。</span></div>
      <div class="it"><b style="background:${T.ink900}">2</b><span>主管条只对 lock:takeover / system:view 渲染，32px 定高常驻；「待批授权」开审批抽屉，「谁在编辑」chip 点按跳到那屏那期；右侧审核计数。</span></div>
      <div class="it"><b style="background:${T.ink900}">3</b><span>行状态由数据派生不可手勾；右侧审核态列：未交审 / 待审核 / 已审核（人·日期）/ 已退回（理由）。待审核与已审核的表任何入口都改不了。</span></div>
      <div class="it"><b style="background:${T.ink900}">4</b><span>页签定宽 148px 带「屏 · 期」，改名不位移；面包屑后上下文 chip 常驻预留位；★ 改为固定页签；主题钮删。</span></div>
    </div>
  </div>`
  return wrap('推荐方案 · 本月出账', body, CSS2)
}

// ═══════════════════════════════════════════════════════════════
// Artboard 5 — Directions · 三方向低保真对比
// ═══════════════════════════════════════════════════════════════
function directions() {
  const card = (name, score, thesis, changes, weak, win) => `
    <div class="lo" style="flex:1;min-width:0;${win ? `border:2px solid ${T.ink900};` : ''}">
      <div style="display:flex;align-items:baseline;justify-content:space-between;"><h4>${name}</h4><span class="score" style="color:${win ? T.ink900 : T.muted}">${score}</span></div>
      <p><b>主攻</b>：${thesis}</p>
      <p><b>动什么</b>：${changes}</p>
      <p style="color:${T.red}"><b>评审扣分</b>：${weak}</p>
    </div>`
  const body = `
  <div style="width:1180px;padding:24px;box-sizing:border-box;background:#fff;">
    <div class="h">三个独立方向 · 三位评审打分（专员点击 25 / 主管高管 15 / 约束兼容 20 / 一屏装下 15 / 单一分类法 15 / 可分期 10）</div>
    <div class="sub" style="margin:4px 0 16px;">分数 = 三位评审总分之和（满分 300）。评审镜头：专员的一个月 · 工程护栏 · IA 可扫描性。三位一致选 A。</div>
    <div style="display:flex;gap:16px;align-items:stretch;">
      ${card('A · 工序优先', '209', '专员按工序用、侧栏按对象列。数据层第一项「本月出账」= 期间矩阵 + 清单；侧栏=恢复现场；角色落地三档。', '一屏新工作台（首页改名补全）；期协议中央化；面板折叠；常用块。', '常用块 + 清单 + 侧栏 三处指向同 15 屏；展开态 644px 装不下（被重算）；两处需拍板。', true)}
      ${card('B · 重切信息架构', '196', '按动词/频次重切 51 屏；驾驶舱 + 监控置顶；系统层退到轨底齿轮；股东无轨。', 'fpNav 组行（目录项）+ 手风琴；navHeight.spec 护栏；后端 4→5 步；收入核对搬层。', '专员点击 47→47 持平；主管零收益；股东无轨破 XL 冻结；目录项破 DESIGN-FIDELITY §2.4.1。', false)}
      ${card('C · 最小改动修语义', '176', '不动 fpNav：修 open/openFresh、深链协议、死 UI、在场点、折叠记忆。', 'nav/deepLink.ts + useDeepPeriod；evicted 提示；scopePeriod；角色派生；常用块。', '面板高度自报 760 实算 946（假绿）；无主管落地；高管仍落数据层；行号引用失真。', false)}
    </div>
    <div style="margin-top:18px;padding:14px 16px;border-radius:14px;background:${T.sunken};font-size:12.5px;line-height:19px;color:${T.ink700};">
      <b style="color:${T.ink900}">综合 = A 骨架</b> + B 的动词组名、手风琴、navHeight.spec、buildChain 5 步、anaData 走 fpAllPages + C 的 useDeepPeriod、evicted 提示、scopePeriod、角色派生、搜索文案。
      <b style="color:${T.ink900}">砍掉</b>：常用块（第二指针）、新建 month-close 屏（首页改名即可）、矩阵 5 颗点、B 的目录项与股东无轨、收入核对搬层。
      <b style="color:${T.ink900}">对抗复核推翻 4 条并改写</b>：首页第 5 步判据用 priceOk 不用 stale；银行流水删条目不过滤；首页行显式 pick 不给 adoptYm 加 force；手风琴不自动收回。
    </div>
  </div>`
  return wrap('三方向对比', body, CSS2)
}

// ═══════════════════════════════════════════════════════════════
// Artboard 6 — Tabs · 页签条与顶栏 现状 vs 方案
// ═══════════════════════════════════════════════════════════════
function tabsBoard() {
  const before = `
    <div style="border:1px solid ${T.ink100};border-radius:16px;overflow:hidden;">
      ${tabstrip([{ icon: 'layout-dashboard', label: '数据中心首页' }, { icon: 'book-open', label: '月度台账', on: true, prev: true }, { icon: 'file-check-2', label: '催缴单' }, { icon: 'file-check-2', label: '催缴单' }])}
      ${toolbar('数据中心', '月度台账')}
    </div>`
  const after = `
    <div style="border:1px solid ${T.ink100};border-radius:16px;overflow:hidden;">
      <div class="fp-tabstrip">
        <div class="fp-tab2">${icon('calendar-check', 14)}<span class="t">本月出账 · 2024-02</span><span class="fp-tab-x">${icon('x', 12)}</span></div>
        <div class="fp-tab2 on">${icon('book-open', 14)}<span class="t">月度台账 · 2024-02 · A 公司</span><span class="fp-tab-x">${icon('x', 12)}</span></div>
        <div class="fp-tab2">${icon('file-check-2', 14)}<span class="t">催缴单 · 2024-01</span><span class="fp-tab-x">${icon('x', 12)}</span></div>
        <div class="fp-tab2">${icon('file-check-2', 14)}<span class="t">催缴单 · 2024-02</span><span class="fp-tab-x">${icon('x', 12)}</span></div>
        <div class="fp-tab-add">${icon('plus', 14)}</div>
      </div>
      <div class="fp-toolbar">
        <div class="fp-ib">${icon('panel-left', 16)}</div>
        <div class="fp-ib">${icon('pin', 16)}</div>
        <div class="fp-crumb"><span class="g">数据中心</span><span class="s">/</span><span class="p">月度台账</span></div>
        <div class="fp-ctx">${icon('calendar', 13)}<span class="num">2024-02</span><span style="color:${T.muted}">· A 公司</span></div>
        <div class="fp-tb-right">
          <div class="fp-presence"><div class="fp-avatar" style="width:22px;height:22px;font-size:10px;background:${T.brandDeep}">李</div><span class="cap" style="margin-left:6px">1 人在线</span></div>
          <div class="fp-search">${icon('search', 15)}<span style="flex:1">搜索页面 / 分组…</span><span class="fp-kbd">Ctrl K</span></div>
          <div class="fp-ib" style="position:relative">${icon('bell', 16)}</div>
        </div>
      </div>
    </div>`
  const body = `
  <div style="width:1180px;padding:24px;box-sizing:border-box;background:#fff;display:flex;flex-direction:column;gap:14px;">
    <div class="h">页签条与顶栏 · 现状 → 方案</div>
    <div class="sub">现状：两个「催缴单」页签分不清是哪期；★ 与 ☀ 是死钮；搜索框承诺「租户 / 凭证」。</div>
    ${before}
    <div class="sub">方案：页签定宽 148px（Chrome 式）带「屏 · 期 · 公司」，改名不位移；面包屑后上下文 chip 常驻预留位（无期显 —）；★ 改为「固定页签」；☀ 删除；搜索文案只承诺做得到的。</div>
    ${after}
  </div>`
  return wrap('页签条与顶栏', body, CSS2)
}

// ═══════════════════════════════════════════════════════════════
// Artboard 7 — Review · 审核机制（一张表 × 一个月；只读；只有审核员能撤销）
// ═══════════════════════════════════════════════════════════════
function reviewBoard() {
  const sm = (t, sub, bg, fg) => `<div class="sm" style="background:${bg};color:${fg};border-color:transparent"><span>${t}</span><span style="font-size:10.5px;font-weight:400;opacity:.8">${sub}</span></div>`
  const ar = (lbl, who) => `<div class="arrow"><span><b style="color:${T.ink900}">${lbl}</b></span><div class="ln"></div><span>${who}</span></div>`
  const body = `
  <div style="width:1180px;padding:24px;box-sizing:border-box;background:#fff;display:flex;flex-direction:column;gap:16px;">
    <div>
      <div class="h">审核机制 · 一张表 × 一个月</div>
      <div class="sub" style="margin-top:4px;">已拍板：粒度 = 一张表 × 一个月；已审核 = 只读，只有审核员能撤销。新角色「审核员」只有 <code>review:approve</code>，零编辑权（录审分离）。</div>
    </div>
    <div class="box">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px;">状态机（每个审核键，如 <code>ledger:A:2024-02</code>）</div>
      <div style="display:flex;align-items:center;gap:10px;">
        ${sm('录入中', '派生态 · 可编辑', T.sunken, T.ink900)}
        ${ar('交审', '录入方 · 需该表 edit 权')}
        ${sm('待审核', '锁 · 审核员队列', 'oklch(0.96 0.04 62)', T.orange)}
        ${ar('通过', '审核员')}
        ${sm('已审核 🔒', '只读 · 任何入口都改不了', 'oklch(0.95 0.04 150)', T.green)}
        <div style="flex:1"></div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:${T.ink700};">
          <span class="rv ret" style="height:24px;padding:0 10px;">${icon('rotate-ccw', 12)}退回（审核员 + 理由）→ 录入中</span>
          <span class="rv ret" style="height:24px;padding:0 10px;">${icon('lock-open', 12)}撤销审核（审核员 + 理由）→ 录入中</span>
        </div>
      </div>
      <div class="sub" style="margin-top:12px;">前置：公共电核算通过需 参数 + 抄表 已审核；催缴单通过需 公摊 + 损耗 已审核。下游已审核时上游不能撤销（先撤催缴单才能撤公摊）。整月锁账 = 该月全部键已审核，自动派生，没有单独的锁账按钮。</div>
    </div>
    <div style="display:flex;gap:16px;">
      <div class="box" style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">屏内：编辑模式按钮位的三种态（同尺寸，零位移）</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <span class="btn solid">${icon('pencil', 13, '#fff')}编辑模式</span><span class="sub">录入中 / 已退回</span>
          <span class="btn dis">${icon('clock-3', 13)}待审核 · 已交审</span><span class="sub">交审后即锁</span>
          <span class="btn dis">${icon('lock', 13)}已审核 · 李审 03-05</span><span class="sub">tooltip：撤销审核需审核员</span>
        </div>
        <div class="sub" style="margin-top:10px;">后端同样拦：所有写路径（含导入、复制上月、参数重算）先过 <code>ReviewGuard</code>，已审/待审一律 423，消息写明谁、何时审核。主管的接管锁、当场提权都绕不过。</div>
      </div>
      <div class="box" style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">审核员落地：本月出账 + 审核条</div>
        <div class="sup" style="margin-bottom:10px;"><span class="chip pend">${icon('clock-3', 11)}待审核 <span class="num">2</span></span><span class="chip">只看待审</span><span style="margin-left:auto;" class="chip ok">${icon('shield-check', 11)}本月已审 <span class="num">6</span>/13</span></div>
        <div class="crow" style="border:1px solid ${T.ink100};border-radius:10px;padding:0 10px;"><span class="nm" style="width:72px;flex-basis:72px">园区抄表</span><span class="dt">王五 交审 03-04</span><span class="rv pend">${icon('clock-3', 11)}待审核</span><span class="btn solid" style="height:24px;padding:0 10px;font-size:12px;">通过</span><span class="btn" style="height:24px;padding:0 10px;font-size:12px;">退回</span></div>
        <div class="crow" style="border:1px solid ${T.ink100};border-radius:10px;margin-top:6px;padding:0 10px;"><span class="nm" style="width:72px;flex-basis:72px">计费参数</span><span class="dt">电价 6/6</span><span class="rv ok">${icon('shield-check', 11)}已审核 · 李审 03-05</span><span class="btn" style="height:24px;padding:0 10px;font-size:12px;">${icon('lock-open', 12)}撤销</span></div>
      </div>
      <div class="box" style="flex:0 0 300px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">撤销审核 · 居中弹卡</div>
        <div style="border:1px solid ${T.ink100};border-radius:12px;padding:12px;box-shadow:${T.shadowPop};">
          <div style="font-size:13px;font-weight:600;">撤销审核</div>
          <div class="sub" style="margin:2px 0 8px;">2024-02 · A 公司 · 月度台账</div>
          <div style="border:1px solid ${T.ink300};border-radius:8px;height:52px;padding:6px 8px;font-size:12px;color:${T.muted};">理由（必填）：3 月租金列录错，专员申请改…</div>
          <div class="sub" style="margin:8px 0;">撤销后回到「录入中」，可编辑；写入操作日志。</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;"><span class="btn" style="height:26px;">取消</span><span class="btn solid" style="height:26px;">确认撤销</span></div>
        </div>
      </div>
    </div>
  </div>`
  return wrap('审核机制', body, CSS2)
}

// ═══════════════════════════════════════════════════════════════
const artboards = [
  { file: 'Current.dc.html', html: currentShell(), x: 0, y: 0, w: 1366, h: 880, title: '现状 · 数据中心层（1366×620 内视口）' },
  { file: 'CurrentPanels.dc.html', html: currentPanels(), x: 1460, y: 0, w: 820, h: 1120, title: '现状 · 三层面板真实高度' },
  { file: 'Main.dc.html', html: mainPanels(), x: 0, y: 1260, w: 1180, h: 760, title: '推荐方案 · 侧边栏三层默认态' },
  { file: 'Tabs.dc.html', html: tabsBoard(), x: 1260, y: 1260, w: 1180, h: 360, title: '推荐方案 · 页签条与顶栏' },
  { file: 'Hub.dc.html', html: hubScreen(), x: 0, y: 2160, w: 1366, h: 780, title: '推荐方案 · 本月出账（1366×620）' },
  { file: 'Directions.dc.html', html: directions(), x: 1460, y: 2160, w: 1180, h: 560, title: '三方向对比与综合' },
  { file: 'Review.dc.html', html: reviewBoard(), x: 0, y: 3060, w: 1180, h: 560, title: '审核机制（一张表 × 一个月）' },
]

for (const a of artboards) fs.writeFileSync(path.join(OUT, a.file), a.html)
const canvas = {
  artboards: artboards.map(({ file, x, y, w, h, title }) => ({ file, x, y, w, h, title })),
  annotations: [
    { id: 'brief', x: 0, y: -170, w: 720, text: '侧边栏与使用动线重设计 · 2026-09-03 · 待拍板\n\n第一行：现状（从 tokens.css / AppShell / IconRail / SidebarPanel / SidebarNav 逐像素复原，非截图），红色编号 = 调研坐实的九个问题。\n第二行：推荐方案的侧栏三层默认态 + 页签/顶栏。\n第三行：「本月出账」落地屏 + 三方向评审对比。\n文档：docs/research/2026-09-03-sidebar-ux-research/（01 现状审计 · 02 同类产品 · 03 综合结论 · 04 方案与 13 个待拍板）。' },
    { id: 'decisions', x: 1260, y: 1660, w: 1180, text: '必须由你拍板（04 §3）：D1 侧栏点击 = 恢复现场（翻 2026-07-07 B3）· D2 首页行显式选月覆盖会话期 · D4 银行流水删条目 · D6 后端 LoginResp 加 roleNames · D7 合同移入档案 · D8 P2 后端 DTO 增 companies/phases · D9 KeepAlive 10→16 · D10 页签定宽 148 · D12 屏名「本月出账」· D13 顺序 P1→P4→P0→P3→P2→R1→R2→P5。\n明确不做：编辑模式提权捆绑（专员每月 4 次输密码原样）、主管签发/作废 UI、异常处置落库、实体搜索、移动端布局。' },
    { id: 'review-note', x: 1260, y: 3060, w: 720, text: '审核机制（2026-09-03 追加，04 §8）\n已拍板：一张表 × 一个月；已审核只读，只有审核员能撤销。\n待确认的假设：D16 审核员独立角色、主管默认无审核权 · D17 待审核也锁 · D18 年表按月审 · D19 下游已审上游不能撤 · D20 锁账 = 全月已审派生（取消 period_close 表）。' },
  ],
  launch: { view: 'canvas' },
}
fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(canvas, null, 2))
console.log('wrote', artboards.map(a => a.file).join(', '), '+ canvas.json')
