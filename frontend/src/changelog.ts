// 给用户看的更新记录 —— 全站只有这一处。
//
// 用户看得见的改动,在同一个 PR 里做完这几件事(什么时候必须做:VERSION-UPDATE-SPEC §8;
// 版本号怎么涨、写几条、每条多少字、配图画什么:RELEASE-NOTES-SPEC,能自动查的都在 changelog.spec):
//   ① 改 package.json 的 version(版本号只有那一个来源,构建时注入 __APP_VERSION__);
//   ② 在下面 CHANGELOG 数组**最前面**加一段,版本号与 ① 一致;
//   ③ 换掉 WhatsNewDialog.vue 里重点卡的静态配图(.wn-pic),不换就画着上一版的内容。
// 之后正常构建部署:功能更新第一次打开时自动弹「本次更新」,小调整只亮顶栏 ✦ 的蓝点;✦ 里随时能翻(VERSION-UPDATE-SPEC)。
//
// 怎么写(设计稿「一条更新怎么写」那一段):
//   · 用用户的话,不贴提交记录,不写「重构 / 门禁 / 口径」这类开发用语;
//   · 标题就叫那一屏在侧栏里的名字;说明一句话,说他能做什么;
//   · 分三组:added = 以前没有的屏或功能,improved = 原来就有、现在更好用,
//     fixed = 原来算错或点不动 —— 写「原来哪里不对」,一行一条;
//   · 能跳过去的条目给 `to`(侧栏里那一屏的 value,见 nav/fpNav.ts;首页是 'home');跳不过去就别给。
//   · 有新增时,最重要的那条新增放 `feature`(弹窗顶上单独一张卡,标签写死是「新增」);没有新增就不写 feature。
// ⚠ 这里的每个字都会原样上屏,写完自己读一遍。
import type { ReleaseNote } from '@/types/changelog'

export const CHANGELOG: ReleaseNote[] = [
  {
    version: '0.14.0',
    date: '2026-09-19',
    headline: '页签和浏览器一样用，登录后先到首页',
    feature: {
      icon: 'home',
      title: '首页',
      desc: '登录后先到这里：搜索、收藏的页面、最近打开的页面都在这一页。它固定在页签最左边，关不掉。',
      to: 'home',
    },
    added: [
      { icon: 'star', title: '收藏', desc: '点页面名后面的 ☆ 收藏这一页，在首页上能找到，最多 12 个。' },
      { icon: 'panels-top-left', title: '页签能拖动和右键', desc: '页签能拖动换位置；右键能固定、关闭其他、重新打开关掉的页签；点 + 新建。' },
    ],
    improved: [
      { icon: 'layers', title: '页签和浏览器一样用', desc: '原来点导航换掉斜体的预览页签，现在换掉当前页签（首页除外）；按住 Ctrl 点开新页签。' },
      { icon: 'arrow-left', title: '路径能点、图标有说明', desc: '点「数据中心」这样的前一段回到这一层的第一屏；鼠标在图标上停半秒会说明用途。' },
      { icon: 'users', title: '在线的人看得清', desc: '原来头像太小看不清，现在头像放大了、写着名字的后两个字，旁边直接写几个人在线。' },
      { icon: 'pen-line', title: '正在改的页面不会被换掉', desc: '改到一半点左边导航，会开到新页签；关掉正在改的页签前会先问一句。' },
    ],
    fixed: [
      '月度台账、三大报表、账册模板、角色管理、新建合同：改到一半关浏览器，原来不会先问一句',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-09-18',
    headline: '月结审核上线，产品改名「灵睿」',
    feature: {
      icon: 'badge-check',
      title: '月结审核',
      desc: '三大报表、月度台账等 15 个屏可以「交审」。审核人在右上角铃铛里看到待审明细，点一下直达那张表；自己交的、还没人审，可以撤回。',
      to: 'data-home',
      toLabel: '去本月出账',
    },
    added: [
      { icon: 'git-compare', title: '租户对标', desc: '新屏：看一户的单位租金在同类厂房里排在哪。', to: 'tenant-peer' },
      { icon: 'calendar-clock', title: '到期墙与续约', desc: '加了合约租金带、续签率，和「先谈哪几户」清单。', to: 'expiry' },
      // 不写行数:出账 7 行 / 记账 12 行,而行数会随附表增减而变,写死就会过期(2026-09-18 复查时
      // 稿上那句「记账 8 行」已经对不上了)。
      { icon: 'list-checks', title: '本月出账两栏清单', desc: '出账、记账分两栏列出来，本月还差哪张表一眼能看到。', to: 'data-home' },
      { icon: 'sparkles', title: '更新记录', desc: '就是你正在看的这个：每次更新会告诉你改了什么，以后点右上角 ✦ 随时能翻。' },
    ],
    improved: [
      { icon: 'tags', title: '产品改名「灵睿 LinkSight」', desc: '换了新标志；登录页换成暗色流动背景。' },
      { icon: 'panels-top-left', title: '页签记住期间和公司', desc: '页签标题显示「屏名 · 期 · 公司」；从别的屏点过来，直接落到那一期。' },
      { icon: 'message-square', title: '图上关键点改成深色气泡', desc: '保本点、回收点这类标注，字更清楚。' },
      { icon: 'sun', title: '光伏分栋分析重做', desc: '20 块图按新版式重排。', to: 'pv-meter-analysis' },
      { icon: 'zap', title: '打开和切换更顺', desc: '弹窗、页签切换有了过渡；分析屏首次打开，版面不再跳动。' },
      { icon: 'log-in', title: '被顶下线时说明原因', desc: '同一账号在别处登录后，这边退出时会说明原因。' },
    ],
    fixed: [
      '出租与楼栋：不管有没有数据都说「单元面积未录入」；平均分摊率显示成 139511%',
      '光伏分栋抄表被别人接管后，按钮点了没反应、被退出编辑也没有提示',
      '园区抄表、公共电核算、催缴单等六个录入屏，补上了编辑锁的提示弹窗',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-08-27',
    headline: '远程授权与编辑锁',
    added: [
      { icon: 'shield-check', title: '远程授权', desc: '没有权限时可以向主管申请，批准后当场能改。' },
      { icon: 'lock', title: '编辑锁', desc: '同一张表同一时间只能一个人改；顶栏头像能看到谁在看、谁在编辑。' },
      { icon: 'book-open', title: '账册版本', desc: '可以切换台账模板版本，已录入的月份不受影响。' },
    ],
    improved: [
      { icon: 'pen-line', title: '编辑模式全站统一', desc: '所有录入屏都是「先看，点编辑再改」。' },
      { icon: 'book-open', title: '台账结余按月结转', desc: '上月结余自动带到下月。' },
    ],
    fixed: [],
  },
  {
    version: '0.11.0',
    date: '2026-08-15',
    headline: '抄表与核算屏整轮打磨',
    added: [
      { icon: 'file-text', title: '催缴单导出', desc: '通知单和对账表，一户一个文件。' },
      { icon: 'sliders-horizontal', title: '系数簿', desc: '在催缴单页批量改租户的管理费单价和层份。' },
      { icon: 'gauge', title: '表计筛选', desc: '加了「已退场」「未启用」，设错的表能自己找回来。' },
    ],
    improved: [
      { icon: 'layers', title: '浮层点外面就关', desc: '下拉、弹出菜单统一行为。' },
      { icon: 'table-2', title: '数字等宽', desc: '金额和读数竖排能对齐。' },
    ],
    fixed: [],
  },
  {
    version: '0.10.0-beta.1',
    date: '2026-07-21',
    headline: '能源分析',
    added: [
      { icon: 'zap', title: '电费、充电桩分析', desc: '两个新分析屏。' },
      { icon: 'zap', title: '园区电费成本模型', desc: '4 类 8 张表。' },
      { icon: 'sun', title: '光伏分栋抄表、充电桩分桩明细', desc: '按月记条、按栋汇总。' },
      { icon: 'wallet', title: '账单管理页', desc: '附表10 工资条、打印。' },
    ],
    improved: [
      { icon: 'list', title: '合同、租户列表', desc: '每页行数按屏幕高度自动调整。' },
    ],
    fixed: [],
  },
  {
    version: '0.9.0',
    date: '2026-07-13',
    headline: '公测',
    added: [
      { icon: 'layout-dashboard', title: '41 个屏全部上线', desc: '数据中心、账簿与报表、经营分析三层。' },
      { icon: 'file-text', title: '催缴导出、只读角色、到期墙', desc: '' },
    ],
    improved: [],
    fixed: [],
  },
]

/** 当前跑在浏览器里的这一版(构建时由 vite.config.ts 注入)。 */
export const APP_VERSION = __APP_VERSION__

/** 按语义比版本号:逐位比数字,预发布后缀不参与。a 比 b 新返回正数。 */
export function cmpVersion(a: string, b: string): number {
  const x = a.split('-')[0].split('.').map(Number)
  const y = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** 功能更新 = 版本号最后一位是 0(0.15.0、1.0.0);最后一位不是 0 的是小调整(RELEASE-NOTES-SPEC §1)。 */
export function isFeatureVersion(v: string): boolean {
  return Number(v.split('-')[0].split('.')[2] ?? 0) === 0
}

/** 当前版本对应的那一段;版本号没写进 CHANGELOG 时(忘了加)返回 undefined,调用方按「没有可弹的」处理。 */
export function noteOf(version: string): ReleaseNote | undefined {
  return CHANGELOG.find((n) => n.version === version)
}
