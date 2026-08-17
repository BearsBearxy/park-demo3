// 计费参数注册表——后端 service/ParamRegistry.java 的 TS 镜像(S21-PARAM-CENTER-SPEC §2.3/§3):
// 键 → 人话 label/单位/分区(①monthly 本月参数 ②constant 长期常数 ③rule 核算口径 ④tenant 户级例外)/默认生效方式/
// 值类型(枚举给字典)/算式人话/提示/是否可作户级例外/成对配套键。
// 两份必须逐键一致:后端 ParamRegistryTest 导出 target/param-registry.json → 拷到 utils/__fixtures__/param-registry.json,
// paramRegistry.spec.ts 逐键比对(后端改注册表 → 重跑 ParamRegistryTest 拷 fixture → 同步本表)。
// 退役键(loss_g_adj / price_flat / price_loss / price_norm|sharp|peak|valley / green_rate_live / lamp_rate_live / loss_rate)不在此列。
// 文案铁律(spec §5.2):不出现字段名、id、building:/rule: 之类内部标识、「默认·所有月份」。
export type ParamGroup = 'monthly' | 'constant' | 'rule' | 'tenant'
export type ParamMode = 'from' | 'month'
export type ParamValueKind =
  | 'number' | 'rate' | 'money' | 'int' | 'bool' | 'enum' | 'ref_meter' | 'ref_building' | 'ref_rule'

export interface ParamDef {
  key: string
  label: string
  unit: string
  group: ParamGroup
  defaultMode: ParamMode
  monthlyCheck: boolean                  // 列入 ① 区「本月核对」
  valueKind: ParamValueKind
  enumOptions?: Record<number, string>   // valueKind=enum 的字典(值存数字,页面显文字)
  formula?: string
  hint?: string
  tenantEditable?: boolean               // 允许 tenant:{id} 作用域 → ④ 区新增例外 / 系数簿键源
  pairedWith?: string                    // 成对写的配套键(电力管理费双键)
  monthOnly?: boolean                    // 只能按月生效(= 后端 价目表 && 默认 month:电价 6 键 + 照抄金额;from 会被 400「只能按月生效」)
}

// 顺序 = 后端 all() 顺序 = 页面各区内渲染顺序
export const PARAM_DEFS: ParamDef[] = [
  { key: 'elec_commercial', label: '商业电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '商业电费单价 = 商业电价 + 电力管理费（商业）；缺当月电价该期不生成',
    hint: '代理购电按月变；一期公摊池成本与损耗折算价的底价' },
  { key: 'elec_peak', label: '峰段电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '分时电费单价 = 分段电价 + 电力管理费；缺当月电价该期不生成',
    hint: '代理购电按月变' },
  { key: 'elec_sharp', label: '尖段电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '分时电费单价 = 分段电价 + 电力管理费；缺当月电价该期不生成',
    hint: '名义价，实收按「尖段按尖价计收比例」折算' },
  { key: 'elec_flat', label: '平段电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '分时电费单价 = 分段电价 + 电力管理费；缺当月电价该期不生成',
    hint: '代理购电按月变；二期公摊池成本的底价（供电局综合电价未填时也作二期损耗折算价的底价）' },
  { key: 'elec_valley', label: '谷段电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '分时电费单价 = 分段电价 + 电力管理费；缺当月电价该期不生成',
    hint: '代理购电按月变' },
  { key: 'elec_resident', label: '居民电价（宿舍）', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '宿舍电费单价 = 居民电价 + 电力管理费',
    hint: '单一价' },
  { key: 'elec_grid_avg', label: '供电局综合电价（月均）', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '二期损耗折算价 = 供电局综合电价 + 电力管理费；本月未填时按 平段电价 + 电力管理费',
    hint: '供电局账单总金额 ÷ 总度数（与源册火炬园「高压用电分配」单价同源；2024-02 二期 1.09312）' },
  { key: 'sharp_as_peak_ratio', label: '尖段按尖价计收比例', unit: '比例', group: 'monthly', defaultMode: 'from', monthlyCheck: true, valueKind: 'rate',
    formula: '尖段实收单价 = 尖段电价 × 比例 + 峰段电价 × (1 − 比例)',
    hint: '0 = 尖段全部按峰价计收；二期 2023 下半年 1 → 0.0994 → 0；可按户设置',
    tenantEditable: true },
  { key: 'elevator_area_base', label: 'A座电梯分摊面积基数', unit: '㎡', group: 'monthly', defaultMode: 'from', monthlyCheck: true, valueKind: 'number',
    formula: 'A座电梯分摊标准 = 电梯池成本 ÷ 分摊面积基数（元/㎡）',
    hint: '源册逐月手改；本月未填沿用上一版本' },
  { key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'number',
    formula: '收取损耗率 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点',
    hint: '正数多收（加大损耗），负数少收；按楼栋设，仅当月' },
  { key: 'loss_rate_manual', label: '损耗率（手工指定）', unit: '比率', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'rate',
    formula: '填写后直接作为该栋收取损耗率，公式算出的率并列备查',
    hint: '源册手填常量的统一入口（如 B座 0.0156、二三四车间 0.0015）' },
  { key: 'extra_qty', label: '公摊池加减度数', unit: '度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'number',
    formula: '公摊池用量 = 所属电表用量合计 + 加减度数（扣减填负数）',
    hint: '招商中心净电 2023-12 −1470 / 2024-02 −670；货梯 +170 / +100 / +200' },
  { key: 'manual_qty', label: '公摊池手工用量', unit: '度或吨', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'number',
    formula: '无电表的公摊池：用量直接取手工填写值',
    hint: '宿舍绿化水 84 吨' },
  { key: 'loss_base_park_amount', label: '损耗基数附加金额（按月）', unit: '元', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '损耗费基数 = 户电费 + 公摊 + 电力管理费 + 本金额',
    hint: '永龙：逐月照抄源册；未填时按附加电表度数 × 平段电价',
    tenantEditable: true },
  { key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '电费单价 = 电价 + 电力管理费',
    hint: '全园 0.16；户级例外 0.15 / 0.10 / 0（与「电力管理费（商业）」成对写）',
    tenantEditable: true,
    pairedWith: 'mgmt_fee_commercial' },
  { key: 'mgmt_fee_commercial', label: '电力管理费（商业）', unit: '元/度', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '商业电费单价 = 商业电价 + 电力管理费（商业）',
    hint: '全园 0.32',
    tenantEditable: true },
  { key: 'capacity_fee', label: '装机容量费', unit: '元/kVA·月', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '容量费 = 装机容量 × 单价（按合同天数折算）',
    hint: '22.6（2023-08 为 23）；可莱恩 / 芷泉 23',
    tenantEditable: true },
  { key: 'water', label: '水价', unit: '元/吨', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '水费 = 用水量 × (水价 + 水管网维护费)',
    hint: '全园 3.95；宿舍 3.85；固定额户 4.45（配套管网费 0）',
    tenantEditable: true },
  { key: 'water_pipe', label: '水管网维护费', unit: '元/吨', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '水费 = 用水量 × (水价 + 水管网维护费)',
    hint: '全园 0.5；宿舍 0',
    tenantEditable: true },
  { key: 'lamp_area_base', label: '路灯分摊面积基数', unit: '㎡', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '路灯分摊标准 = 路灯池成本 ÷ 分摊面积基数（元/㎡）',
    hint: '一期 80,000；宿舍 15,510（园区可出租面积）' },
  { key: 'green_area_base', label: '绿化水分摊面积基数', unit: '㎡', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '绿化水分摊标准 = 绿化水池成本 ÷ 分摊面积基数（元/㎡）',
    hint: '一期 80,000' },
  { key: 'area_base', label: '园区分摊面积基数', unit: '㎡', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '园区级公摊（消防设施 / 路灯 / 绿化泵）分摊标准 = 池成本 ÷ 园区分摊面积基数',
    hint: '二期 148,918.01' },
  { key: 'park_share_div', label: '园区公共电均摊栋数', unit: '栋', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'int',
    formula: '公摊分摊度数 = 园区公共电池当月净量合计 ÷ 均摊栋数（四舍五入到 2 位）',
    hint: '一期 6 栋' },
  { key: 'loss_adj_rate', label: '损耗率加点', unit: '比率', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'rate',
    formula: '收取损耗率 = 公式率 + 加点',
    hint: '一期 0.003（F座曾 0.005）；二期 0.002；按楼栋设' },
  { key: 'coefficient', label: '分摊基数（层数或面积）', unit: '', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '分摊标准 = 公摊池成本（或用量）÷ 分摊基数',
    hint: '二期按已出租层数；一期层侧公共表按受益面积合计；走面积基数的池不用它' },
  { key: 'std_add', label: '分摊标准附加金额', unit: '元', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '分摊标准 = 算式值 + 附加金额',
    hint: '广联 +100' },
  { key: 'price_override', label: '公摊池指定单价', unit: '元/度', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '公摊池成本 = 用量 × 指定单价（不取价目）',
    hint: '宿舍路灯 1.13156875 / 绿化水 4.45' },
  { key: 'loss_variant', label: '损耗核算方式', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'enum',
    enumOptions: { 0: '按损耗量核算（率 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点）', 1: '仅按公摊分摊度数（率 = 公摊分摊度数 ÷ 分母 + 加点）', 2: '不核算（只列示用量）' },
    formula: '按损耗量核算：率 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点；仅按公摊分摊度数：率 = 公摊分摊度数 ÷ 分母 + 加点；不核算：只列示用量',
    hint: 'B座 / C座 2023-11 起仅按公摊分摊度数；G座 不核算' },
  { key: 'loss_head', label: '损耗核算归组', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_building',
    formula: '并入所指楼栋一组核算、共用一块总表；未指定或指向自身 = 独立核算',
    hint: '二期 二 / 四车间并入三车间；一车间 2023-08、09 并入五车间' },
  { key: 'loss_c_meter', label: '总表取数', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_meter',
    formula: '该栋总表读数只取指定的那块表，其余总表不计入总表也不计入分表合计；未指定 = 全部总表',
    hint: 'A座 仅取「A座总电」' },
  { key: 'loss_recon', label: '供电局对账', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'bool',
    formula: '是否参与「供电局总表 与 各栋总表合计 / 各栋分表合计」两行对账',
    hint: 'A座 独立供电线路，不参与' },
  { key: 'loss_exclude', label: '不计入楼栋合计的电表', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'bool',
    formula: '该表不计入所在楼栋的总表合计与分表合计',
    hint: '抄表册合计明确剔除的行（力美C201电 / 四车间工地 / 广告字分表）' },
  { key: 'loss_denom_cable', label: '损耗率分母', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'bool',
    formula: '收取损耗率的分母取 仅总表 或 总表 + 铝缆',
    hint: '二期 2023-08、09 含铝缆，2023-10 起仅总表；可按期或按栋设' },
  { key: 'loss_supply_meter', label: '供电局对账总表', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_meter',
    formula: '对账供给侧 = 该总表读数（不参与任何楼栋损耗）',
    hint: '一期 B-G座总电；二期 二期总电' },
  { key: 'frozen_2023', label: '2023 年冻结单价（仅备查）', unit: '元', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '该公摊池在原册使用的 2023 年冻结单价，引擎不读取' },
  { key: 'elec_package', label: '电费一口价', unit: '元/度', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '电费 = 用量 × 一口价（已含电力管理费）',
    hint: '孵化户 1.0 / 商铺 1.5',
    tenantEditable: true },
  { key: 'share_elec_fixed', label: '公共电费固定月额', unit: '元/月', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '按协议固定金额收取，替代「楼层公共 + 电梯 + 路灯」三项公摊',
    hint: '孵化协议',
    tenantEditable: true },
  { key: 'share_water_fixed', label: '公共水费固定月额', unit: '元/月', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '按协议固定金额收取，替代「绿化水」公摊',
    hint: '孵化协议',
    tenantEditable: true },
  { key: 'green_rate', label: '绿化水公摊单价（户）', unit: '元/㎡', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '绿化水公摊 = 面积 × 单价（未设置时按当月池核算率）',
    hint: '约 37 户沿用旧口径 0.01',
    tenantEditable: true },
  { key: 'lamp_rate', label: '路灯公摊单价（户）', unit: '元/㎡', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '路灯公摊 = 面积 × 单价（未设置时按当月池核算率）',
    hint: '旧口径 0.005',
    tenantEditable: true },
  { key: 'fire_amount_fixed', label: '消防照明固定月额', unit: '元', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '消防照明按固定金额收取；0 = 免收',
    hint: '曹小芳 / 刘彪 照抄旧值 175.48 / 72.59',
    tenantEditable: true },
  { key: 'loss_base_form', label: '损耗费计费基数（形态）', unit: '', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'enum',
    enumOptions: { 1: 'A：电费 + 公摊 + 电力管理费', 2: 'B：电费 + 公摊（默认）', 3: 'C：电费 + 容量费', 6: 'F：电费 + 公摊（去电梯）+ 电力管理费', 7: 'G：电费 + 公摊 + 电力管理费 + 附加电表电费' },
    formula: '损耗费 = 计费基数 × 收取损耗率；基数按形态圈定费项',
    hint: '整户设置；按楼栋另设见「损耗费计费基数（按栋）」',
    tenantEditable: true },
  { key: 'loss_base_form_b{bid}', label: '损耗费计费基数（按栋）', unit: '', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'enum',
    enumOptions: { 1: 'A：电费 + 公摊 + 电力管理费', 2: 'B：电费 + 公摊（默认）', 3: 'C：电费 + 容量费', 6: 'F：电费 + 公摊（去电梯）+ 电力管理费', 7: 'G：电费 + 公摊 + 电力管理费 + 附加电表电费' },
    formula: '同「损耗费计费基数（形态）」，仅对该栋所在损耗组生效，优先于整户设置',
    hint: '邓宇峰：三车间组 F、六车间组默认',
    tenantEditable: true },
  { key: 'loss_base_park_meter', label: '损耗基数附加电表', unit: '', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_meter',
    formula: '损耗费基数附加该电表电费（度数 × 平段电价；有按月附加金额则用金额）',
    hint: '永龙 反向有功表',
    tenantEditable: true },
]

// 前缀键:loss_base_form_b{楼栋id}(按楼栋损耗链的基数形态)注册一条模板,查询按前缀匹配(与 Java get() 同规则)
export const LOSS_BASE_FORM_B_TEMPLATE = 'loss_base_form_b{bid}'
const LOSS_BASE_FORM_B = /^loss_base_form_b\d+$/
const BY_KEY = new Map(PARAM_DEFS.map(d => [d.key, d]))
export const paramDef = (key: string): ParamDef | undefined =>
  BY_KEY.get(key) ?? (LOSS_BASE_FORM_B.test(key) ? BY_KEY.get(LOSS_BASE_FORM_B_TEMPLATE) : undefined)

// 户级例外配套写计划(spec §3.4 / S14 §3.1 惯例):主键 → 成组写的键(fixed=写死值,缺省=写用户值);缺省=只写自身。
// 参数页 ④ 新增例外/[删] 与 系数簿 共用这一份 —— 分叉过一次(参数页只按 pairedWith 同值写,漏了 water_pipe=0 / 一口价 mgmt=0,
// 户级水价/一口价被引擎多叠管网费/管理费),写计划只许在这里改。
export interface ParamWrite { key: string; fixed?: number }
const TENANT_WRITES: Record<string, ParamWrite[]> = {
  mgmt_fee: [{ key: 'mgmt_fee' }, { key: 'mgmt_fee_commercial' }],                                        // 双键同值(引擎走哪支都被压过)
  water: [{ key: 'water' }, { key: 'water_pipe', fixed: 0 }],                                              // 户级水价已含管网费
  elec_package: [{ key: 'elec_package' }, { key: 'mgmt_fee', fixed: 0 }, { key: 'mgmt_fee_commercial', fixed: 0 }],   // 一口价已含管理费
}
export const writePlan = (key: string): ParamWrite[] => TENANT_WRITES[key] ?? [{ key }]
