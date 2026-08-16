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
  { key: 'elec_commercial', label: '商业裸电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成',
    hint: '代理购电逐月变；一期公摊池成本与损耗费单价的底价' },
  { key: 'elec_peak', label: '峰段裸电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成',
    hint: '代理购电逐月变' },
  { key: 'elec_sharp', label: '尖段裸电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成',
    hint: '名义价；实收按「尖峰按尖价收取比率」折算' },
  { key: 'elec_flat', label: '平段裸电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成',
    hint: '代理购电逐月变；二期公摊池成本与损耗费单价的底价' },
  { key: 'elec_valley', label: '谷段裸电价', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成',
    hint: '代理购电逐月变' },
  { key: 'elec_resident', label: '居民裸电价（宿舍）', unit: '元/度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成',
    hint: '单一价' },
  { key: 'sharp_as_peak_ratio', label: '尖峰按尖价收取比率', unit: '比率', group: 'monthly', defaultMode: 'from', monthlyCheck: true, valueKind: 'rate',
    formula: '尖段实收单价 = 尖价 × 比率 + 峰价 × (1 − 比率)',
    hint: '政策开关：0 = 尖段全按峰价收；二期 2023 下半年 1→0.0994→0；可按户设',
    tenantEditable: true },
  { key: 'elevator_area_base', label: 'A座电梯面积基数', unit: '㎡', group: 'monthly', defaultMode: 'from', monthlyCheck: true, valueKind: 'number',
    formula: 'A座电梯分摊标准 = 电梯池成本 ÷ 面积基数（元/㎡）',
    hint: '源册逐月手改（2023 下半年四个值）；本月无专属值即沿用上一版本' },
  { key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'number',
    formula: '收取率 = −(分表合计 − 总表 − 公摊度数 − 调整度数) ÷ 分母 + 加点',
    hint: '正数=多收（加大损耗），负数=少收；按楼栋组头设，仅当月' },
  { key: 'loss_rate_manual', label: '手工收取损耗率', unit: '比率', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'rate',
    formula: '填了就直接用它作收取损耗率，公式算出的率并排备查',
    hint: '源册手填常量的统一出口（如 B座 0.0156、二三四车间 0.0015）' },
  { key: 'extra_qty', label: '池加度 / 扣度', unit: '度', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'number',
    formula: '池净量 = Σ绑定表用量 + 加度（扣度填负数）',
    hint: '招商中心净电 2023-12 −1470 / 2024-02 −670；货梯 +170 / +100 / +200（2023-12 起）' },
  { key: 'manual_qty', label: '池手输用量', unit: '度或吨', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'number',
    formula: '无表池：用量直接取手输值，不读电表',
    hint: '宿舍绿化水 84 吨' },
  { key: 'loss_base_park_amount', label: '损耗基数：园区表金额（照抄册面）', unit: '元', group: 'monthly', defaultMode: 'month', monthlyCheck: true, valueKind: 'money', monthOnly: true,
    formula: '损耗费基数 = 户电费 + 公摊 + 管理费 + 本金额（形态 G）',
    hint: '永龙：逐月照抄源册金额；无值时按园区表度数 × 平段价推',
    tenantEditable: true },
  { key: 'mgmt_fee', label: '电力管理费（分时 / 居民）', unit: '元/度', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '电费单价 = 裸电价 + 电力管理费',
    hint: '全园 0.16；户级例外 0.15 / 0.10 / 0（与商业维护费成对写）',
    tenantEditable: true,
    pairedWith: 'mgmt_fee_commercial' },
  { key: 'mgmt_fee_commercial', label: '商业维护费', unit: '元/度', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '商业电费单价 = 商业裸电价 + 商业维护费',
    hint: '全园 0.32；一期公摊池与损耗费单价同口径',
    tenantEditable: true },
  { key: 'capacity_fee', label: '装机容量费', unit: '元/kVA·月', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '容量费 = 装机容量(kVA) × 单价（按合同天数折算）',
    hint: '22.6（2023-08 为 23）；可莱恩 / 芷泉 23 户级',
    tenantEditable: true },
  { key: 'water', label: '水价', unit: '元/吨', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '水费 = 用水量 × (水价 + 水管网维护费)',
    hint: '全园 3.95；宿舍 3.85；包干户 4.45（配套管网费 0）',
    tenantEditable: true },
  { key: 'water_pipe', label: '水管网维护费', unit: '元/吨', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '水费 = 用水量 × (水价 + 水管网维护费)',
    hint: '全园 0.5；宿舍 0',
    tenantEditable: true },
  { key: 'lamp_area_base', label: '路灯面积基数', unit: '㎡', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '路灯分摊标准 = 路灯池成本 ÷ 面积基数（元/㎡）',
    hint: '一期 80000；宿舍 15510' },
  { key: 'green_area_base', label: '绿化面积基数', unit: '㎡', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '绿化水分摊标准 = 绿化水池成本 ÷ 面积基数（元/㎡）',
    hint: '一期 80000' },
  { key: 'area_base', label: '园区面积基数', unit: '㎡', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '园区级池（消防设施 / 路灯 / 绿化泵）分摊标准 = 池成本 ÷ 园区面积基数',
    hint: '二期 148918.01' },
  { key: 'park_share_div', label: '一期园区公共电均摊栋数', unit: '栋', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'int',
    formula: '公摊分摊度数 = ROUND(Σ园区公摊池当月净量 ÷ 均摊栋数, 2)',
    hint: '6（五个月不变）' },
  { key: 'loss_adj_rate', label: '损耗加点', unit: '比率', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'rate',
    formula: '收取率 = 公式率 + 加点',
    hint: '一期 0.003（F座曾 0.005）2023-10 起；二期 0.002；按楼栋组头设' },
  { key: 'coefficient', label: '池分母（层数 T / 受益面积Σ）', unit: '', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'number',
    formula: '分摊标准 = 池成本（或用量）÷ 分母',
    hint: '唯一存放处；有面积基数键的池不用它（分母走对应面积基数）' },
  { key: 'std_add', label: '池分摊标准末端加价', unit: '元', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '分摊标准 = 算式值 + 末端加价',
    hint: '广联 +100' },
  { key: 'price_override', label: '池单价覆盖', unit: '元/度', group: 'constant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '池成本 = 用量 × 覆盖单价（不走价目簿）',
    hint: '宿舍路灯 1.13156875 化石价 / 绿化水 4.45' },
  { key: 'loss_variant', label: '损耗核算方式', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'enum',
    enumOptions: { 0: '正常核算（损耗 = 分表合计 − 总表）', 1: '纯公摊（率 = 公摊度数 ÷ 总表 + 加点）', 2: '不核算（只陈列度数）' },
    formula: '正常核算：率 = −(分表合计 − 总表 − 公摊度数 − 调整度数) ÷ 分母 + 加点；纯公摊：率 = 公摊度数 ÷ 分母 + 加点',
    hint: 'B座 / C座 2023-11 起纯公摊；G座 不核算' },
  { key: 'loss_head', label: '并入他栋计损', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_building',
    formula: '与所指楼栋合并成一组、共用一块总表计损；指向自身 = 独立核算',
    hint: '二期 二 / 四车间并入三车间；一车间 2023-08/09 并入五车间' },
  { key: 'loss_c_meter', label: '组总表只认这一块表', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_meter',
    formula: '该栋总表读数只取所指的表，其余总表既不入总表也不入分表合计',
    hint: 'A座 只认「A座总电」' },
  { key: 'loss_recon', label: '参与供电侧对账', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'bool',
    formula: '是否参与「供电侧总表 vs 单元合计」两行对账',
    hint: 'A座 独立供电链路，不参与' },
  { key: 'loss_exclude', label: '剔出所在栋的合计', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'bool',
    formula: '该表不计入所在栋的总表 / 分表合计',
    hint: '抄表册段落合计明确剔除的行（力美C201电 / 四车间工地 / 广告字分表）' },
  { key: 'loss_denom_cable', label: '损耗率分母含铝缆', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'bool',
    formula: '开：分母 = 总表 + 铝缆；关：分母 = 总表',
    hint: '二期 2023-08/09 含铝缆，2023-10 起只取总表；期或栋级' },
  { key: 'loss_supply_meter', label: '供电侧对账总表', unit: '', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_meter',
    formula: '对账供给边 = 所指总表的读数（该表不入任何损耗组）',
    hint: '一期 B-G座总电；二期 二期总电' },
  { key: 'frozen_2023', label: '2023 冻结价（不参与计算）', unit: '元', group: 'rule', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '只作披露：该池在原册的 2023 冻结价，引擎不读',
    hint: '隐藏死模板 公共电分摊!M99/M109/L24/L99' },
  { key: 'elec_package', label: '包干电价', unit: '元/度', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '电费 = 用量 × 包干价（已含管理费，配套管理费双键 = 0）',
    hint: '包干户 1.0 / 商铺 1.5',
    tenantEditable: true },
  { key: 'share_elec_fixed', label: '公共用电包干额', unit: '元/月', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '替代「楼层公共 + 电梯 + 路灯」三项公摊，按月固定额',
    hint: '孵化协议固定收取',
    tenantEditable: true },
  { key: 'share_water_fixed', label: '公共用水包干额', unit: '元/月', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '替代「绿化水」公摊，按月固定额',
    hint: '孵化协议固定收取',
    tenantEditable: true },
  { key: 'green_rate', label: '绿化水收取价', unit: '元/㎡', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '绿化水公摊 = 面积 × 收取价（无户级值 = 当月池核算率）',
    hint: '0.01 组约 37 户（沿用旧模板）',
    tenantEditable: true },
  { key: 'lamp_rate', label: '路灯收取价', unit: '元/㎡', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '路灯公摊 = 面积 × 收取价（无户级值 = 当月池核算率）',
    hint: '旧口径 0.005 户',
    tenantEditable: true },
  { key: 'fire_amount_fixed', label: '消防照明固定额', unit: '元', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'money',
    formula: '消防照明按固定额收取；0 = 免收',
    hint: '曹小芳 / 刘彪 照抄旧值 175.48 / 72.59',
    tenantEditable: true },
  { key: 'loss_base_form', label: '损耗费基数形态', unit: '', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'enum',
    enumOptions: { 1: 'A：电费 + 公摊 + 管理费', 2: 'B：电费 + 公摊（默认）', 3: 'C：电费 + 容量费', 6: 'F：电费 + 公摊（去电梯）+ 管理费', 7: 'G：电费 + 公摊 + 管理费 + 园区表电费' },
    formula: '损耗费 = 基数 × 收取损耗率；基数按形态圈行',
    hint: '整户；按楼栋链另设见「损耗费基数形态（按栋）」',
    tenantEditable: true },
  { key: 'loss_base_form_b{bid}', label: '损耗费基数形态（按栋）', unit: '', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'enum',
    enumOptions: { 1: 'A：电费 + 公摊 + 管理费', 2: 'B：电费 + 公摊（默认）', 3: 'C：电费 + 容量费', 6: 'F：电费 + 公摊（去电梯）+ 管理费', 7: 'G：电费 + 公摊 + 管理费 + 园区表电费' },
    formula: '同「损耗费基数形态」，只对该楼栋所在损耗链生效，优先于整户设置',
    hint: '邓宇峰：三车间链 F、六车间链默认',
    tenantEditable: true },
  { key: 'loss_base_park_meter', label: '损耗基数：园区表', unit: '', group: 'tenant', defaultMode: 'from', monthlyCheck: false, valueKind: 'ref_meter',
    formula: '损耗费基数附加所指园区表的电费（度数 × 平段价；有照抄金额则用金额）',
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
// 参数页 ④ 新增例外/[删] 与 系数簿 共用这一份 —— 分叉过一次(参数页只按 pairedWith 同值写,漏了 water_pipe=0 / 包干 mgmt=0,
// 户级水价/包干价被引擎多叠管网费/管理费),写计划只许在这里改。
export interface ParamWrite { key: string; fixed?: number }
const TENANT_WRITES: Record<string, ParamWrite[]> = {
  mgmt_fee: [{ key: 'mgmt_fee' }, { key: 'mgmt_fee_commercial' }],                                        // 双键同值(引擎走哪支都被压过)
  water: [{ key: 'water' }, { key: 'water_pipe', fixed: 0 }],                                              // 户级水价已含管网费
  elec_package: [{ key: 'elec_package' }, { key: 'mgmt_fee', fixed: 0 }, { key: 'mgmt_fee_commercial', fixed: 0 }],   // 包干价已含管理费
}
export const writePlan = (key: string): ParamWrite[] => TENANT_WRITES[key] ?? [{ key }]
