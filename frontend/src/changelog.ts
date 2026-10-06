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
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 2、3 问是):五个分析屏照 2026-10 改稿画布重排(用户 2026-10-05「先实现设计好改动的这几屏」,
  // 拍板便签全按推荐)。用法变了:驾驶舱按月 / 按年各看各的、对比开关撤掉;用能与缴费按年原来 = 12 月,现在是全年。
  // 数量会变:异常提醒中心风险分没数的项记 0(原来缺项按其余项放大),销售收入表停了的户收入、能耗两项也算没数(高风险 69 → 5 户);
  // 清单不再按档分组、整张按未收从多到少(火炬 ¥113万 排第 1);能耗突变只比相邻自然月(248 → 218 户)。
  // 金额不变:售电收入仍取销售收入表逐户合计(用户 10-05 定),期末欠费仍是台账期末结余;只改呈现与两条计数规则,不动已结账的数。
  // 没有新屏、新入口以外的新功能(两条去别屏的文字链算改进里的入口),所以不写重点卡、不画配图。
  // 2026-10-06 并入光伏分栋分析(用户「按推荐，然后开始实现这一屏」):首屏加各栋每千瓦日均发电,带比上月 / 比去年;
  // 金额会变:上网收益原来写死 ¥0.40/kWh,现在按计费参数 pv_grid_price 逐月取(开发库 0.453),所有月份的光伏收益都会变;
  // 只是分析屏上的展示,不动任何已结账的单据。异常提醒中心加光伏两条规则(每千瓦日均超 24 kWh、连着偏离平时),并进该屏那一条;
  // 园区能耗「光伏发电」改名「光伏自用和上网」只是改字,不单列。
  {
    version: '0.31.0',
    date: '2026-10-06',
    headline: '驾驶舱等分析屏重排，图下一句话说清',
    added: [],
    improved: [
      { icon: 'gauge', title: '经营驾驶舱', desc: '原来按月也画全年走势，现在按月看这个月和上月比，按年看逐月和往年。', to: 'cockpit' },
      { icon: 'bell-ring', title: '异常提醒中心', desc: '风险分里缺的项原来按其余项放大，现在记 0，高风险户数会变；清单按未收排，加了光伏规则。', to: 'anomaly' },
      { icon: 'building-2', title: '出租与楼栋', desc: '原来是方块图，现在各栋按合同月租排成横条，旁边写租出和空着的单元。', to: 'park' },
      { icon: 'zap', title: '园区能耗', desc: '流向图每个节点直接写本月和上月的金额，同一笔钱全屏只用一个名字。', to: 'park-energy' },
      { icon: 'activity', title: '用能与缴费', desc: '按年原来只看 12 月，现在是全年各户排行，期末欠费和去年同月比。', to: 'tenant-energy' },
      { icon: 'table-2', title: '光伏分栋分析', desc: '原来各栋对比藏在第三档，现在首屏并排各栋每千瓦发电；上网收益改按系统单价算，各月都会变。', to: 'pv-meter-analysis' },
    ],
    fixed: [],
  },
  // 小调整(RELEASE-NOTES-SPEC §2.1 四问皆否:不改金额的修复)→ PATCH,不弹,只进铃铛「系统」与更新记录。
  // 修复一行核实(对照线上 0.26.0):线上 CSS 的 --dur-base 被压成 .2s,rowMotion 用 parseFloat 读成 0.2(毫秒),
  // 展开 / 收起动画只剩 0.2ms 等于没有;本地开发样式不压缩(200ms)所以本地正常。utils/rowMotion.ts cssMs 认 s / ms。
  {
    version: '0.26.1',
    date: '2026-10-03',
    headline: '表格展开收起的动画回来了',
    added: [],
    improved: [],
    fixed: [
      '各屏表格：展开、收起时原来在线上没有动画，一下子跳开',
    ],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 1、2、4 问是):导入弹窗换进度卡(新增);临时授权从满宽横条挪进顶栏(顶栏变了 → 写进 headline);
  // 三大报表公司选择从左栏挪进期间条下拉、撤 KPI 卡、资产负债表合表;计费参数长页拆成左目录 + 右当前区;满宽提示条收进状态签 / 就地标注;
  // 页底「ⓘ 单位 · 口径」行删掉(画布 2026-10-02 第 35 版 08–11 节 + 横条盘点,用户 2026-10-03「按稿实现、第二类选推荐」)。
  // 金额不变:只改版式与导入流程,取数与算法没动。
  // 「从断掉的那一段接着导」:附表 10 逐段导入,网络或 5xx 失败给「从第 k 段接着导」(importRun.ts / ImportProgressCard)。
  // 「报表底部说明」只讲三大报表(单位进卡头、口径挂净利润 / 总计 / 合计行);年份门的页底说明并进副标题,不在这句里。
  // 修复一行核实(对照 master):CoefBookWindow 的 .cb-unibar、PayBookWindow 的 .pb-unibar 在 editMode 时新增一整行,表格下移
  // (noInteractionLayoutShift.spec 原白名单两条即此)。
  // 「表格展开收起」:utils/rowMotion.ts,全站 <table> 点击后行有增有留才动(用户 2026-10-03 要,压过动效稿 C5-04)。
  // 「点名称就能开合」:utils/rowToggle.ts,纯分组行整行、带数据的父行名称那一格(计费参数 / 园区抄表 / 三大报表 / 科目余额表 / 电费成本 / 公共电核算分时段)。
  // 账册模板那行核实(对照 master):TemplateEditorPanel 在途时主区换成一行 .te-loading,弹窗按内容定高(max-height 88vh)又居中 → 实测 950→429→950。
  {
    version: '0.26.0',
    date: '2026-10-03',
    headline: '临时授权挪进顶栏，导入时弹窗不再关掉',
    feature: {
      icon: 'upload',
      title: '导入进度',
      desc: '点「导入」后弹窗不再关掉，换成进度卡，写完原地显示写入和跳过的条数。'
        + '附表 10 按段显示写到第几段；中途断网或服务器出错，能从那一段接着导。',
    },
    added: [],
    improved: [
      { icon: 'lock', title: '临时授权', desc: '原来页面顶上一条满宽横条，现在是铃铛左边的钥匙按钮，点开看谁授权、还剩多久。' },
      { icon: 'trending-up', title: '三大报表', desc: '原来公司在左栏，现在在期间条的下拉里；资产负债表左右两半合成一张表。', to: 'income-statement' },
      { icon: 'sliders-horizontal', title: '计费参数', desc: '原来一整页往下滚，现在左边目录、右边一区一张表，改值时贴着格子弹出。', to: 'params' },
      { icon: 'message-square', title: '页面提示', desc: '原来不少页面顶上会多出一整条提示，现在收进标题旁的小标签，或标在相关的那一行。' },
      { icon: 'list', title: '表格展开收起', desc: '原来要点准箭头，展开时一下子跳开；现在点名称就能开合，下面的行平滑让开。' },
      { icon: 'table', title: '报表底部说明', desc: '原来页底一行写单位和算法，现在单位挪到表格上方，算法悬停在净利润、总计、合计行上。' },
    ],
    fixed: [
      '系数簿、收款簿：进编辑模式时，原来表格会被往下推一行',
      '账册模板：点历史版本时，原来整张卡片会先缩下去再撑开',
    ],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 1、2 问是):通知统一进顶栏铃铛(新增,顶栏用法变了 → 写进 headline),
  // 全站确认 / 提示收成十件标准件,宽表固定列按表格宽度退,公共电核算 / 园区抄表 / 催缴单三屏改版(画布 2026-09-29 第 26 版)。
  // 「表格列宽」一条管两件:宽表固定列按表格宽度退;全站表格余宽放进行末空列(2026-10-02 用户拍板,画布 09/10,LIST-PAGE §4)——
  // 不只宽表,楼栋 / 租户 / 附表 / 三大报表 / 分析层都改了,所以标题不写屏名、不给 to。
  // 金额不变:三屏只改版式,取数与算法没动。
  // 修复一行核实(对照 master):① useEditMode 的 scope 变了直接 exit(),FPStepStrip 返回钮不问 —— 编辑中换出账月改动直接丢;
  // ② ds/Select 挂载即在 document 上常驻 keydown 捕获,收着也 stopPropagation 所有 Esc —— 页面上有下拉框时弹窗、抽屉按 Esc 关不掉。
  {
    version: '0.25.0',
    date: '2026-10-01',
    headline: '通知都进顶栏铃铛，提示换成同一套样子',
    feature: {
      icon: 'bell',
      title: '铃铛通知',
      desc: '点顶栏的铃铛，分三组看：等你处理、有结果了、系统。'
        + '红数字是等你处理的件数，蓝点是有没看过的结果或更新。授权请求在里面输密码就能批。',
    },
    added: [],
    improved: [
      { icon: 'message-square', title: '确认和提示', desc: '原来用浏览器自带的确认框和提示框，现在换成软件里的弹窗和底部回执。' },
      { icon: 'table', title: '表格列宽', desc: '原来固定列能占满屏、名称和数字隔得远；现在固定列按表宽让位，多出的空白留在表格最右边。' },
      { icon: 'share-2', title: '公共电核算', desc: '原来列多、一格挤两行，现在一行一个读数，尖峰平谷按需展开。', to: 'alloc' },
      { icon: 'gauge', title: '园区抄表', desc: '原来顶上六张统计卡，现在并进状态页签，停用的表收在组尾。', to: 'meters' },
      { icon: 'file-check-2', title: '催缴单', desc: '原来四张统计卡、八个按钮，现在并进状态页签，警告直接写是哪一类。', to: 'bill-notices' },
      { icon: 'alert-triangle', title: '待处理', desc: '原来点开是右侧抽屉，现在贴着入口弹出，点一条跳到表里那一行。', to: 'alloc' },
    ],
    fixed: [
      '各屏：编辑中换出账月，原来没保存的改动会直接丢掉',
      '弹窗和抽屉：页面上有下拉框时，原来按 Esc 关不掉',
    ],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 2、3 问是):催缴单的月份改成收费月(用户 2026-09-28 拍板「做乙」)。
  // 出处:源册《2023年9月租金》第一个 sheet 是「2023年8月水电费」,通知单标题「2023年9月租金、物业维护费通知单」。
  // 「N 月的单 = N−1 月水电 + N 月租金」:BillNoticeService.utilityYm / 前端 billingChain.noticeYmOf。
  // 「已出的单往后挪一个月」:V132 迁移;「草稿重新生成后租金改为当月的,已确认、已导出的不变」:generate 跳过锁定户(S20 §1.3)。
  // 「园区抄表批删连带下个月的草稿」:MeterService.batchDelete 的 nym。
  // 修复一行:master 上 9-1 起租、8 月有读数的户(本地库飞浪、谢福兵等 6 户)8 月单报 W_METER_NO_CONTRACT;
  // 现在表在水电月零覆盖时认收费月的合同(MeterBindingService.rentMonthPick),BillNoticeApiIT.t41 钉住。
  {
    version: '0.24.0',
    date: '2026-09-28',
    headline: '催缴单改按收费月，9 月的单含 8 月水电',
    added: [],
    improved: [
      { icon: 'file-check-2', title: '催缴单', desc: '原来 8 月的单是 8 月水电加 8 月租金，现在 9 月的单是 8 月水电加 9 月租金。', to: 'bill-notices' },
      { icon: 'history', title: '已出的催缴单', desc: '所有已出的单往后挪一个月，草稿重新生成即可；已确认、已导出的单租金是上个月的，要作废重出。', to: 'bill-notices' },
      { icon: 'gauge', title: '园区抄表', desc: '批量删读数时，原来连带删同月的草稿催缴单，现在删下个月的那批。', to: 'meters' },
    ],
    fixed: [
      '催缴单：9 月 1 日起租、8 月就有用电的户，原来显示无合同',
    ],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 1 问是):续签对话框加「递增」,新段 link_type=escalation(用户 2026-09-27 拍板)。
  // 原本并在 0.22.0 那段里,PR #58 合并时这个提交还没推上去,0.22.0 已照原样上线,所以另起一版。
  // 「不计入续签率」的出处:expiry.logic.ts 有 escalation 后继的前段是 midTier、不进分母,续签命中只认 linkType=renew 的后继
  // —— 换段那一下既不算一次到期也不算一次续签;新的递增段自己到期后照常进分母(expiry.logic.spec「只有末档 tier2 是一次真到期」)。
  // 「上一段写已递增」:ContractDrawer 的 nextIsEscalation、FPContractChain 的 escalatedAway。
  // 「整户跳过」的出处:ContractService.importFull 该户有任一 escalation 段即整行跳过(ESCALATION-SPLIT-SPEC §4)。
  // 修复一行(对抗复查 F1):master 的 ContractService.renew 一续签就把旧合同标 renewed,新合同还没起租时旧合同
  // 从月租金合计、楼栋出租率、单元占用里掉出去(IT 实测单元 occupied→vacant、KPI 82880→74880);现在新合同起租后才标
  // (用户 2026-07-28 裁定,contract-status-fix.sql)。ContractWriteApiIT.renew_asEscalation_…_inForceOldStaysActive 钉住。
  {
    version: '0.23.0',
    date: '2026-09-27',
    headline: '续签能选递增，提前续签的旧合同照常在租',
    feature: {
      icon: 'trending-up',
      title: '续签能选递增',
      desc: '在合同管理里点「续签」，能选「递增」：同一份合同到年限涨价，建下一个价格档。'
        + '涨价那次不计入续签率，上一段写「已递增」。这户再导合同汇总册会整户跳过。',
      to: 'contracts',
    },
    added: [],
    improved: [],
    fixed: [
      '合同管理：提前续签后，旧合同在新合同起租前就不算在租了',
    ],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 1、2、3 问都是):公摊池的绑定表、折入链能按月设(V131,计划 D1–D4/D7),
  // 抽屉里「只改本月起」从「摊给谁」挪到抽屉级、管三处(原来只管受益人);取整位挪进计费参数页按月生效(D5,用法变了);
  // G1:二期 #15/#21 两块广告字灯池(纯标准行、fold_price 源)出应分摊并进合计 —— 金额会变。
  // 「重新生成的月份起变」:应分摊落在池快照里,不重新生成就不变;「审过的月份不变」:AllocService.generate 开头
  // reviewGuard.assertEditable(ALLOC / ALLOC_LOSS),审核锁着的月份生成不了;「户的收费不变」:两池摊出仍只走折入标准
  // (allocatedAmount=0),PoolMonthlyConfigIT.g1_… 的户级断言组钉住。
  {
    version: '0.22.0',
    date: '2026-09-26',
    headline: '池的电表和折入能按月改，二期合计会变',
    feature: {
      icon: 'calendar-clock',
      title: '公共电核算的池能按月改',
      desc: '在编辑模式里点开一个池，勾上「只改本月起」，这次改的电表、折入的标准和受益人从这个月起用，之前的月份不动。'
        + '原来只有受益人能这样改。',
      to: 'alloc',
    },
    added: [],
    improved: [
      { icon: 'sliders-horizontal', title: '分摊标准小数位', desc: '原来在池的「高级」里改，现在到计费参数页改，能从某个月起改；新建池仍在「高级」里选。', to: 'params' },
      { icon: 'sigma', title: '公共电核算的二期合计', desc: '五、六车间广告字灯池出应分摊，计入合计了。各月重新生成后才变，审过的月份和户的收费不变。', to: 'alloc' },
    ],
    fixed: [],
  },
  // 功能更新(RELEASE-NOTES-SPEC §2.1 第 3 问是):用户 2026-09-25 线上导入二期 2023-08 原册,同址的「谢福兵临电」(无码)
  // 被按位置认成有码的「谢福兵电」,真表那一行被判同批重复没导(master 的 MeterService.importRows 按行序认表 + G6)——
  // 重导那个月的册子后真表读数、用量、金额会变。现在:有码行先认表并占住当月;无码行按位置认到有码且异名的表不认、另建一块并提示。
  // 写「核对」不写「改对」:册子里真表那个月没有行的(飞浪电、张炳南电),重导只新建临电表,真表上记错的那个月读数不会被删。
  // 「审过的月份不变」的出处:importRows 开头 reviewGuard.assertEditable,已审的月整批拒。
  // 复合名提示(master 对所有「、/」企业名称都报)改为只报 ownership = tenant 的行 —— 修复一行。
  {
    version: '0.21.0',
    date: '2026-09-25',
    headline: '同址的临电表和真表，导入分得开了',
    added: [],
    improved: [
      { icon: 'file-spreadsheet', title: '园区抄表的临电表', desc: '原来导入时会认成同址的真表，现在另建一块。重导那月册子后核对真表读数，审过的月份不变。', to: 'meters' },
    ],
    fixed: [
      '园区抄表：同址两块表一起导入，有编码那块的读数没导进去',
      '园区抄表：公用表导入时也提示企业名称是复合名',
    ],
  },
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
