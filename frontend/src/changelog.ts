// 给用户看的更新记录 —— 全站只有这一处。
//
// 用户看得见的改动,在同一个 PR 里做完这几件事(什么时候必须做:VERSION-UPDATE-SPEC §8;
// 版本号怎么涨、写几条、每条多少字、配图画什么:RELEASE-NOTES-SPEC,能自动查的都在 changelog.spec):
//   ① 改 package.json 的 version(版本号只有那一个来源,构建时注入 __APP_VERSION__);
//   ② 在下面 CHANGELOG 数组**最前面**加一段,版本号与 ① 一致;
//   ③ 有重点卡的版本:在 components/shell/release/ 新建 Art<版本>.vue 画这一版的配图,登记进 art.ts
//     (不覆盖旧的 —— 弹窗和更新记录都按版本取图)。
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
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 1 问是):表档案从一份改成按月一段一段记(METER-TIMELINE-SPEC),
  // 新增「档案变更」页签、撤销导入、终止合同空出表、催缴单作废。「已算好的金额不变」的出处:V128 灌数后
  // 每个月的归属与在册状态和旧档案逐格比 0 处不等;池里 +1 绑定的表归属全是公摊 / 运管,按月过滤不剔掉任何一块。
  // 同版并入 SPEC §10「本月册子已核」:状态筛选「本月册子里没有」;不回填,所以写明旧月份要把册子再导一次(§10.2)。
  // 同版并入用户 2026-09-24「删不了」:批删本期能连带删草稿催缴单、删表被催缴单挡住时写明哪几个月 —— 合成修复一行,
  // 为腾字数压短了重点卡说明(「前面的月份不变」headline 已说)、「审过的月份」与催缴单那行修复。
  // 同版并入用户 2026-09-25「就按你说的改」:一块表拆下装到别处(两条档案共用编码),导入原来报「该编码在档案里重复」
  // (master 的 Index.pick 按编码 2 个候选即歧义),现在按这一行的月份认在册的那块 —— 修复一行;
  // 腾字数:删表那行修复只留原来的现象(确认框里的勾选项自己看得见),状态筛选说明去掉与标题重复的「筛选」。
  {
    version: '0.20.0',
    date: '2026-09-24',
    headline: '表档案按月记，改一个月不动别的月',
    feature: {
      icon: 'history',
      title: '园区抄表的档案变更',
      desc: '点开一块表，「档案变更」里按月列出它归哪户、哪个月起停用或拆了，导入和手改都有记录。'
        + '改某个月只管到下次变动前。升级后已算好的金额不变。',
      to: 'meters',
    },
    added: [
      { icon: 'rotate-ccw', title: '导入能撤销', desc: '导错了册子，能在「档案变更」里整批撤回，读数不动。', to: 'meters' },
      { icon: 'x-circle', title: '终止合同能空出表', desc: '确认框列出这户挂着的表，勾上的自解约次月起空置。', to: 'contracts' },
      { icon: 'file-check-2', title: '催缴单能作废', desc: '已导出的户能作废，理由必填；重新生成本月后，这户按现在的档案重出。', to: 'bill-notices' },
    ],
    improved: [
      { icon: 'gauge', title: '园区抄表按月看档案', desc: '原来翻到哪个月都是最新的档案，现在是那个月的；停用的表照常列出，导出只导在册的表。', to: 'meters' },
      { icon: 'filter', title: '园区抄表的状态筛选', desc: '多了「本月有变化」「缺底数」「本月册子里没有」；旧月份想标对，把那个月的册子再导一次。', to: 'meters' },
      { icon: 'lock', title: '审过的月份不跟着改', desc: '原来改表档案会连抄表已审核、催缴单已确认的月份一起改，现在改不动。', to: 'meters' },
    ],
    fixed: [
      '园区抄表：新建的表出现在建表前的月份里',
      '催缴单：表换户后重新生成，已确认那户和新户都收了这块表',
      '公共电核算、楼栋损耗、催缴单：改了读数或表档案，不提示要重算',
      '园区抄表：删表、批量删被草稿催缴单挡住',
      '园区抄表：表换地方后，导入报编码重复',
    ],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 1 问是):楼栋损耗多了编辑模式与备注这个写入口,
  // 一期另多一组对账行。原定 0.18.1 那批一直没发布,按 §2.1 末句并进本版。
  {
    version: '0.19.0',
    date: '2026-09-23',
    headline: '楼栋损耗能填备注，一期多了一行总计',
    feature: {
      icon: 'pencil',
      title: '楼栋损耗',
      desc: '点右上角「编辑模式」，每一栋后面能填一句备注，写表在哪、这个月为什么对不上。'
        + '重算、改参数都不会把它冲掉。别的数都是算出来的，仍然只读。',
      to: 'alloc-loss',
    },
    added: [
      { icon: 'scale', title: '楼栋损耗的对账区', desc: '一期原来只对到 B–G 座，现在多一组含 A 座的总计。', to: 'alloc-loss' },
    ],
    improved: [
      { icon: 'gauge', title: '公共电核算的用量单位', desc: '原来只有绑了多块表的池写单位，现在每个池都写：电「度」、水「吨」。', to: 'alloc' },
      { icon: 'table-2', title: '公共电核算的「用途」列', desc: '列名原来叫「池名称」，显示的却是这一行电表的用途。池名挪到悬停里。', to: 'alloc' },
      { icon: 'trending-down', title: '楼栋损耗的损耗量', desc: '原来正常有损耗的行标成红字，看着像出错。现在不标，正负号写在表头。', to: 'alloc-loss' },
      { icon: 'bell-ring', title: '改过参数的提示', desc: '公共电核算、楼栋损耗、催缴单原来各叫一个名字，现在统一了。', to: 'alloc' },
      { icon: 'siren', title: '园区抄表的期区', desc: '表的期区和它挂的楼栋对不上时，现在标「期区对不上」。', to: 'meters' },
    ],
    fixed: [
      '楼栋损耗：一期的合计和对账行差一整栋，屏上没说为什么',
      '公共电核算：只绑一块表的池，用量看不出是度还是吨',
      '公共电核算：下月才起租、或没有合同的租户，都被提示成「已退租」',
      '园区抄表：一期的表里混进了一行二期二车间',
      '公共电核算：一楼租户被电梯池提示要加进去，加了也摊不到钱',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-09-23',
    headline: '一户核完当场确认，直接翻下一户',
    added: [],
    improved: [
      { icon: 'file-check-2', title: '核完一户当场确认', desc: '确认、取消确认、上一户 / 下一户都在抽屉底下，不用关抽屉回列表找。', to: 'bill-notices' },
      { icon: 'bell-ring', title: '警告不再占一整行', desc: '收成标题旁的一个小标签，写明是哪一类、有几条。要看是哪几块表就点一下。', to: 'bill-notices' },
      { icon: 'credit-card', title: '收款公司', desc: '原来一屏卡片各印一遍未设置，现在收成一行只报数。展开后一行一项，选完就存。', to: 'bill-notices' },
      { icon: 'layout-grid', title: '抽屉里的上期欠费', desc: '这项还没接通，一直是 0，降成小字。位置那一格宽出来，能多看到十几个字。', to: 'bill-notices' },
      { icon: 'calendar-clock', title: '表和合同的对应', desc: '原来钉死在一份合同上，翻到别的月就报过期；现在自动落到那个月的那一期。', to: 'meters' },
      { icon: 'x-circle', title: '终止合同要填解约日', desc: '填了才知道从哪天起不再收钱。解约当月按天折，之后不出租金；已生成的月份不变。', to: 'contracts' },
    ],
    fixed: [
      '催缴单：换一户看，明细表会上下跳，每次都要重新找',
      '园区抄表：合同明明覆盖这个月还写绑定过期，单上租金和水电算成两期',
      '催缴单：表绑的合同本月没生效，单子上一声不吭',
      '合同管理：终止后下个月照出满月租金；整租合同一续签就变成普通合同',
      '审核：审核员登进去，屏上一颗审核按钮都看不到',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-09-23',
    headline: '催缴单的警告按类分开，点得过去',
    added: [],
    improved: [
      { icon: 'bell-ring', title: '催缴单的警告', desc: '原来是一串挤在一起的字，现在按类分开，点一下直接去改。', to: 'bill-notices' },
      { icon: 'file-check-2', title: '警告里的房号', desc: '原来印成 544.00 像个金额，现在写清是哪间房、哪块表。', to: 'bill-notices' },
      { icon: 'gauge', title: '警告里说的是哪块表', desc: '一户有三块水表时，原来屏上三行都写「水表①」，认不出是哪一块；现在写表名。', to: 'bill-notices' },
    ],
    fixed: [
      '催缴单：收款公司设好了，警告条还在说没设',
      '催缴单：有几项费用在收款方卡片里不出卡，想设也设不了',
      '催缴单：收款方卡片上印出 rent_office 这种英文',
      '催缴单：同一个房间的水表和电表，警告重复报两条',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-09-21',
    headline: '宽表在手机上一行一张卡，平板按小桌面排',
    feature: {
      icon: 'table-2',
      title: '宽表的手机形态',
      desc: '月度台账这类列多的表，在手机上不再横着拖：一行一张卡，卡上是租户、应收、已收和结余，点一张看整行明细。销售收入、工资、电费、科目余额表也换成了卡。台账要按列核对时，从「⋯」里切回表格。',
    },
    added: [
      { icon: 'list-checks', title: '首页的本月出账', desc: '首页上多了一条本月出账，写着五道工序走到哪一步。', to: 'home' },
    ],
    improved: [
      { icon: 'panel-left', title: '报表横着滚的时候', desc: '原来滚到最右就不知道在看哪一行，现在第一列跟着滚不走。', to: 'income-statement' },
      { icon: 'layout-dashboard', title: '平板上的列表页', desc: '原来筛选条会在一行两行之间跳，现在固定两行，表格一列都不删。', to: 'buildings' },
      { icon: 'layout-grid', title: '平板上的指标卡', desc: '原来标签被截成「营业收入…」，现在降成两列，七个字写得下。' },
      { icon: 'credit-card', title: '楼栋和租户的手机卡片', desc: '原来卡上一个钱字都没有，现在第一行右端就是月租金。', to: 'buildings' },
      { icon: 'calendar', title: '本月出账的选月份', desc: '原来一年铺三行，四年就把下面的出账链挤出屏幕，现在一年一行、左右滑。', to: 'data-home' },
    ],
    fixed: [
      '月度台账：租户明细里，负数的费用和空项一起被整条藏掉',
      '园区抄表：手机上一行表格都看不见',
      '三大报表：选公司的侧栏占掉大半个屏，表格只剩一条缝',
      '手机上从首页点进一屏之后，再也回不到首页',
    ],
  },
  {
    version: '0.15.4',
    date: '2026-09-20',
    headline: '分析屏的图不用悬停也能读',
    added: [],
    improved: [
      { icon: 'scroll-text', title: '图下面的结论', desc: '原来要把鼠标停在图上才看得到数，现在每张图下面直接写着最新一期是多少。' },
      { icon: 'activity', title: '光伏分栋分析的图', desc: '原来手机上行挤在一起点不准，现在行高够点，轴上的标签也不再叠在一块。', to: 'pv-meter-analysis' },
      { icon: 'message-square', title: '分析屏图上的说明', desc: '原来手机上不写「这里能点」，现在每张能点的图都写着点哪儿、看什么。' },
    ],
    fixed: [
      '光伏分栋分析：手机上写着「悬停看数」，可手机没有鼠标',
      '经营驾驶舱：附表 10 那张图把月份数写成「期」，和旁边的「近 6 期」不是一个意思',
    ],
  },
  {
    version: '0.15.3',
    date: '2026-09-20',
    headline: '下拉不用鼠标也能选了',
    added: [],
    improved: [
      { icon: 'list', title: '下拉能用键盘', desc: '原来只能用鼠标点，现在按 ↑ ↓ 挑、回车选中，Home 和 End 跳到头尾。' },
    ],
    fixed: [
      '账册模板切版本：点开下拉又点回原来那版，会提示切换成功',
    ],
  },
  {
    version: '0.15.2',
    date: '2026-09-20',
    headline: '账册模板切版本不再弹系统滚轮',
    added: [],
    improved: [
      { icon: 'layers', title: '账册模板切版本', desc: '原来用的是浏览器自带的下拉，在 iPhone 上会弹出系统滚轮；现在和别处的下拉一样。' },
    ],
    fixed: [],
  },
  {
    version: '0.15.1',
    date: '2026-09-20',
    headline: '手机上密码框不再显示成黑条',
    added: [],
    improved: [],
    fixed: [
      '登录、修改密码、用户管理、主管授权：手机上圆点显示成一排黑竖条',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-09-20',
    headline: '能换深色外观，日期选择器和指标卡换了样子',
    feature: {
      icon: 'sun-moon',
      title: '深色外观',
      desc: '点左下角头像，在「外观」里选浅色、深色或跟随系统，点一下整页渐变过去。手机上在导航抽屉里。每个账号记自己的选择，默认浅色。',
    },
    added: [],
    improved: [
      { icon: 'calendar', title: '日期选择器', desc: '原来点开是系统自带的日历，现在换成统一的日历，能直接打字，年和月合成一个框。' },
      { icon: 'layout-grid', title: '指标卡', desc: '屏幕顶部的数字卡片换成浅色底，分析屏小卡去掉了迷你折线。' },
      { icon: 'panel-left', title: '收起导航', desc: '原来点「收起导航」侧栏一下子消失，现在会平滑收起和展开。' },
    ],
    fixed: [],
  },
  {
    version: '0.14.1',
    date: '2026-09-19',
    headline: '更新记录里也能看到重点卡',
    added: [],
    improved: [
      { icon: 'history', title: '更新记录里有重点卡', desc: '原来重点卡和配图只在弹窗里出现一次，现在翻更新记录也能看到。' },
    ],
    fixed: [
      '更新记录：版本列表里的标题太长时会超出框外',
    ],
  },
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
