package com.park.demo3.service;
import java.util.*;
import java.util.regex.Pattern;

// 计费参数注册表(S21-PARAM-CENTER-SPEC §2.3/§3):tenant_price_cfg 与 alloc_cfg 两表参数键的**唯一白名单与人话来源**。
// 每键 = 表(price/alloc) + 人话 label/单位 + 分区(①本月/②长期常数/③核算口径/④户级例外) + 允许的作用域形态 +
// 默认生效方式(from/month) + 值类型(枚举/布尔/引用型给字典) + 算式人话 + 提示。前端 utils/paramRegistry.ts 是镜像
// (ParamRegistryTest 把本表导出 target/param-registry.json 供前端 spec 逐键比对)。
// 退役键(loss_g_adj / price_flat / price_loss / price_norm|sharp|peak|valley / green_rate_live / lamp_rate_live /
// loss_rate)**不注册**:写入一律 400「参数键不在注册表」(spec §3.6)。
// 文案铁律(spec §5.2):label/formula/hint 不出现字段名、id、`building:`/`rule:` 之类内部标识,不出现「默认·所有月份」。
public final class ParamRegistry {
    private ParamRegistry() {}

    public enum Table { PRICE, ALLOC }
    /** ①本月参数 / ②长期常数 / ③核算口径 / ④户级例外(键的"主场";户级作用域行前端一律归 ④) */
    public enum Group { MONTHLY, CONSTANT, RULE, TENANT }
    public enum ScopeKind { GLOBAL, ZONE, BUILDING, METER, RULE, TENANT }
    public enum ValueKind { NUMBER, RATE, MONEY, INT, BOOL, ENUM, REF_METER, REF_BUILDING, REF_RULE }

    public record Def(String key, Table table, String label, String unit, Group group, Set<ScopeKind> scopes,
                      String defaultMode, boolean monthlyCheck, ValueKind valueKind,
                      Map<Integer, String> enumOptions, String formula, String hint,
                      String pairedWith /* 成对写的配套键(电力管理费双键),无=null */) {}

    /** 前缀键:loss_base_form_b{楼栋id} 按楼栋(损耗链)区分的损耗基数形态 —— 注册一条模板,get() 按前缀匹配 */
    public static final String LOSS_BASE_FORM_B_TEMPLATE = "loss_base_form_b{bid}";
    private static final Pattern LOSS_BASE_FORM_B = Pattern.compile("loss_base_form_b\\d+");

    private static final Set<ScopeKind> S_GLOBAL_ZONE = EnumSet.of(ScopeKind.GLOBAL, ScopeKind.ZONE);
    private static final Set<ScopeKind> S_GLOBAL_ZONE_TENANT = EnumSet.of(ScopeKind.GLOBAL, ScopeKind.ZONE, ScopeKind.TENANT);
    private static final Set<ScopeKind> S_ZONE = EnumSet.of(ScopeKind.ZONE);
    private static final Set<ScopeKind> S_ZONE_BUILDING = EnumSet.of(ScopeKind.ZONE, ScopeKind.BUILDING);
    private static final Set<ScopeKind> S_BUILDING = EnumSet.of(ScopeKind.BUILDING);
    private static final Set<ScopeKind> S_METER = EnumSet.of(ScopeKind.METER);
    private static final Set<ScopeKind> S_RULE = EnumSet.of(ScopeKind.RULE);
    private static final Set<ScopeKind> S_TENANT = EnumSet.of(ScopeKind.TENANT);

    private static final Map<Integer, String> LOSS_VARIANT_OPTS = Map.of(
        0, "按损耗量核算（率 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点）",
        1, "仅按公摊分摊度数（率 = 公摊分摊度数 ÷ 分母 + 加点）",
        2, "不核算（只列示用量）");
    private static final Map<Integer, String> ZONE_CALC_KIND_OPTS = Map.of(
        0, "平价制（单一商业价 × 用量）",
        1, "分时制（尖峰平谷四段 + 管理费）");
    private static final Map<Integer, String> LOSS_BASE_FORM_OPTS = Map.of(
        1, "A：电费 + 公摊 + 电力管理费",
        2, "B：电费 + 公摊（默认）",
        3, "C：电费 + 容量费",
        6, "F：电费 + 公摊（去电梯）+ 电力管理费",
        7, "G：电费 + 公摊 + 电力管理费 + 附加电表电费");

    private static final Map<String, Def> DEFS = new LinkedHashMap<>();

    private static void price(String key, String label, String unit, Group group, Set<ScopeKind> scopes, String mode,
                              boolean monthlyCheck, ValueKind kind, Map<Integer, String> opts, String formula, String hint,
                              String pairedWith) {
        DEFS.put(key, new Def(key, Table.PRICE, label, unit, group, scopes, mode, monthlyCheck, kind, opts, formula, hint, pairedWith));
    }
    private static void alloc(String key, String label, String unit, Group group, Set<ScopeKind> scopes, String mode,
                              boolean monthlyCheck, ValueKind kind, Map<Integer, String> opts, String formula, String hint,
                              String pairedWith) {
        DEFS.put(key, new Def(key, Table.ALLOC, label, unit, group, scopes, mode, monthlyCheck, kind, opts, formula, hint, pairedWith));
    }

    static {
        // ── ① 本月参数(默认 month 或 月核对) spec §3.1 ──
        String touF = "分时电费单价 = 分段电价 + 电力管理费；缺当月电价该期不生成";
        price("elec_commercial", "商业电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            "商业电费单价 = 商业电价 + 电力管理费（商业）；缺当月电价该期不生成", "代理购电按月变；一期公摊池成本与损耗折算价的底价", null);
        price("elec_peak", "峰段电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            touF, "代理购电按月变", null);
        price("elec_sharp", "尖段电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            touF, "名义价，实收按「尖段按尖价计收比例」折算", null);
        price("elec_flat", "平段电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            touF, "代理购电按月变；二期公摊池成本的底价（供电局综合电价未填时也作二期损耗折算价的底价）", null);
        price("elec_valley", "谷段电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            touF, "代理购电按月变", null);
        price("elec_resident", "居民电价（宿舍）", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            "宿舍电费单价 = 居民电价 + 电力管理费", "单一价", null);
        // 用户 2026-08-16 拍板(M1):二期损耗「度数口径」折算价不写死,开统一入口 —— 供电局综合月均裸价(账单总金额÷总度数),
        // 与源册火炬园「高压用电分配」单价同源;缺当月值时引擎回退 平段裸价+管理费(spec §4.3)。只影响公共电核算/对账屏陈列,催缴单不读它。
        price("elec_grid_avg", "供电局综合电价（月均）", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            "二期损耗折算价 = 供电局综合电价 + 电力管理费；本月未填时按 平段电价 + 电力管理费", "供电局账单总金额 ÷ 总度数（与源册火炬园「高压用电分配」单价同源；2024-02 二期 1.09312）", null);
        price("sharp_as_peak_ratio", "尖段按尖价计收比例", "比例", Group.MONTHLY, S_GLOBAL_ZONE_TENANT, "from", true, ValueKind.RATE, null,
            "尖段实收单价 = 尖段电价 × 比例 + 峰段电价 × (1 − 比例)", "0 = 尖段全部按峰价计收；二期 2023 下半年 1 → 0.0994 → 0；可按户设置", null);
        price("elevator_area_base", "A座电梯分摊面积基数", "㎡", Group.MONTHLY, S_ZONE, "from", true, ValueKind.NUMBER, null,
            "A座电梯分摊标准 = 电梯池成本 ÷ 分摊面积基数（元/㎡）", "源册逐月手改；本月未填沿用上一版本", null);
        alloc("loss_adj_qty", "损耗调整度数", "度", Group.MONTHLY, S_BUILDING, "month", true, ValueKind.NUMBER, null,
            "收取损耗率 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点", "正数多收（加大损耗），负数少收；按楼栋设，仅当月", null);
        alloc("loss_rate_manual", "损耗率（手工指定）", "比率", Group.MONTHLY, S_BUILDING, "month", true, ValueKind.RATE, null,
            "填写后直接作为该栋收取损耗率，公式算出的率并列备查", "源册手填常量的统一入口（如 B座 0.0156、二三四车间 0.0015）", null);
        alloc("extra_qty", "公摊池加减度数", "度", Group.MONTHLY, S_RULE, "month", true, ValueKind.NUMBER, null,
            "公摊池用量 = 所属电表用量合计 + 加减度数（扣减填负数）", "招商中心净电 2023-12 −1470 / 2024-02 −670；货梯 +170 / +100 / +200", null);
        alloc("manual_qty", "公摊池手工用量", "度或吨", Group.MONTHLY, S_RULE, "month", true, ValueKind.NUMBER, null,
            "无电表的公摊池：用量直接取手工填写值", "宿舍绿化水 84 吨", null);
        price("loss_base_park_amount", "损耗基数附加金额（按月）", "元", Group.MONTHLY, S_TENANT, "month", true, ValueKind.MONEY, null,
            "损耗费基数 = 户电费 + 公摊 + 电力管理费 + 本金额", "永龙：逐月照抄源册；未填时按附加电表度数 × 平段电价", null);

        // ── ② 长期常数(默认 from) spec §3.2 ──
        price("mgmt_fee", "电力管理费", "元/度", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "电费单价 = 电价 + 电力管理费", "全园 0.16；户级例外 0.15 / 0.10 / 0（与「电力管理费（商业）」成对写）", "mgmt_fee_commercial");
        price("mgmt_fee_commercial", "电力管理费（商业）", "元/度", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "商业电费单价 = 商业电价 + 电力管理费（商业）", "全园 0.32", null);
        price("capacity_fee", "装机容量费", "元/kVA·月", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "容量费 = 装机容量 × 单价（按合同天数折算）", "22.6（2023-08 为 23）；可莱恩 / 芷泉 23", null);
        price("water", "水价", "元/吨", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "水费 = 用水量 × (水价 + 水管网维护费)", "全园 3.95；宿舍 3.85；固定额户 4.45（配套管网费 0）", null);
        price("water_pipe", "水管网维护费", "元/吨", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "水费 = 用水量 × (水价 + 水管网维护费)", "全园 0.5；宿舍 0", null);
        price("lamp_area_base", "路灯分摊面积基数", "㎡", Group.CONSTANT, S_GLOBAL_ZONE, "from", false, ValueKind.NUMBER, null,
            "路灯分摊标准 = 路灯池成本 ÷ 分摊面积基数（元/㎡）", "一期 80,000；宿舍 15,510（园区可出租面积）", null);
        price("green_area_base", "绿化水分摊面积基数", "㎡", Group.CONSTANT, S_GLOBAL_ZONE, "from", false, ValueKind.NUMBER, null,
            "绿化水分摊标准 = 绿化水池成本 ÷ 分摊面积基数（元/㎡）", "一期 80,000", null);
        price("area_base", "园区分摊面积基数", "㎡", Group.CONSTANT, S_GLOBAL_ZONE, "from", false, ValueKind.NUMBER, null,
            "园区级公摊（消防设施 / 路灯 / 绿化泵）分摊标准 = 池成本 ÷ 园区分摊面积基数", "二期 148,918.01", null);
        alloc("park_share_div", "园区公共电均摊栋数", "栋", Group.CONSTANT, S_ZONE, "from", false, ValueKind.INT, null,
            "公摊分摊度数 = 园区公共电池当月净量合计 ÷ 均摊栋数（四舍五入到 2 位）", "一期 6 栋", null);
        alloc("loss_adj_rate", "损耗率加点", "比率", Group.CONSTANT, S_BUILDING, "from", false, ValueKind.RATE, null,
            "收取损耗率 = 公式率 + 加点", "一期 0.003（F座曾 0.005）；二期 0.002；按楼栋设", null);
        alloc("coefficient", "分摊基数（层数或面积）", "", Group.CONSTANT, S_RULE, "from", false, ValueKind.NUMBER, null,
            "分摊标准 = 公摊池成本（或用量）÷ 分摊基数", "二期按已出租层数；一期层侧公共表按受益面积合计；走面积基数的池不用它", null);
        alloc("std_add", "分摊标准附加金额", "元", Group.CONSTANT, S_RULE, "from", false, ValueKind.MONEY, null,
            "分摊标准 = 算式值 + 附加金额", "广联 +100", null);
        alloc("price_override", "公摊池指定单价", "元/度", Group.CONSTANT, S_RULE, "from", false, ValueKind.MONEY, null,
            "公摊池成本 = 用量 × 指定单价（不取价目）", "宿舍路灯 1.13156875 / 绿化水 4.45", null);

        // ── ③ 核算口径(结构性,默认 from;栋级人话句子) spec §3.3 ──
        alloc("loss_variant", "损耗核算方式", "", Group.RULE, S_BUILDING, "from", false, ValueKind.ENUM, LOSS_VARIANT_OPTS,
            "按损耗量核算：率 = −(分表合计 − 总表 − 公摊分摊度数 − 调整度数) ÷ 分母 + 加点；仅按公摊分摊度数：率 = 公摊分摊度数 ÷ 分母 + 加点；不核算：只列示用量",
            "B座 / C座 2023-11 起仅按公摊分摊度数；G座 不核算", null);
        alloc("zone_calc_kind", "计费口径", "", Group.RULE, S_ZONE, "from", false, ValueKind.ENUM, ZONE_CALC_KIND_OPTS,
            "决定该期区的公摊池怎么算钱：平价制 = (用量 + 加减度数) × 单一商业价；分时制 = 尖峰平谷四段电价 + 管理费",
            "没配口径的期区不会不出钱——池会先按平价制(商业电价)计费,请到本页显式选口径,避免分时期区被错收平价", null);
        alloc("loss_head", "损耗核算归组", "", Group.RULE, S_BUILDING, "from", false, ValueKind.REF_BUILDING, null,
            "并入所指楼栋一组核算、共用一块总表；未指定或指向自身 = 独立核算", "二期 二 / 四车间并入三车间；一车间 2023-08、09 并入五车间", null);
        alloc("loss_c_meter", "总表取数", "", Group.RULE, S_BUILDING, "from", false, ValueKind.REF_METER, null,
            "该栋总表读数只取指定的那块表，其余总表不计入总表也不计入分表合计；未指定 = 全部总表", "A座 仅取「A座总电」", null);
        alloc("loss_recon", "供电局对账", "", Group.RULE, S_BUILDING, "from", false, ValueKind.BOOL, null,
            "是否参与「供电局总表 与 各栋总表合计 / 各栋分表合计」两行对账", "A座 独立供电线路，不参与", null);
        alloc("loss_exclude", "不计入楼栋合计的电表", "", Group.RULE, S_METER, "from", false, ValueKind.BOOL, null,
            "该表不计入所在楼栋的总表合计与分表合计", "抄表册合计明确剔除的行（力美C201电 / 四车间工地 / 广告字分表）", null);
        alloc("loss_denom_cable", "损耗率分母", "", Group.RULE, S_ZONE_BUILDING, "from", false, ValueKind.BOOL, null,
            "收取损耗率的分母取 仅总表 或 总表 + 铝缆", "二期 2023-08、09 含铝缆，2023-10 起仅总表；可按期或按栋设", null);
        alloc("loss_supply_meter", "供电局对账总表", "", Group.RULE, S_ZONE, "from", false, ValueKind.REF_METER, null,
            "对账供给侧 = 该总表读数（不参与任何楼栋损耗）", "一期 B-G座总电；二期 二期总电", null);
        alloc("frozen_2023", "2023 年冻结单价（仅备查）", "元", Group.RULE, S_RULE, "from", false, ValueKind.MONEY, null,
            "该公摊池在原册使用的 2023 年冻结单价，引擎不读取", null, null);

        // ── ④ 户级例外类(仅户级) spec §3.4 ──
        price("elec_package", "电费一口价", "元/度", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "电费 = 用量 × 一口价（已含电力管理费）", "孵化户 1.0 / 商铺 1.5", null);
        price("share_elec_fixed", "公共电费固定月额", "元/月", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "按协议固定金额收取，替代「楼层公共 + 电梯 + 路灯」三项公摊", "孵化协议", null);
        price("share_water_fixed", "公共水费固定月额", "元/月", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "按协议固定金额收取，替代「绿化水」公摊", "孵化协议", null);
        price("green_rate", "绿化水公摊单价（户）", "元/㎡", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "绿化水公摊 = 面积 × 单价（未设置时按当月池核算率）", "约 37 户沿用旧口径 0.01", null);
        price("lamp_rate", "路灯公摊单价（户）", "元/㎡", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "路灯公摊 = 面积 × 单价（未设置时按当月池核算率）", "旧口径 0.005", null);
        price("fire_amount_fixed", "消防照明固定月额", "元", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "消防照明按固定金额收取；0 = 免收", "曹小芳 / 刘彪 照抄旧值 175.48 / 72.59", null);
        price("loss_base_form", "损耗费计费基数（形态）", "", Group.TENANT, S_TENANT, "from", false, ValueKind.ENUM, LOSS_BASE_FORM_OPTS,
            "损耗费 = 计费基数 × 收取损耗率；基数按形态圈定费项", "整户设置；按楼栋另设见「损耗费计费基数（按栋）」", null);
        price(LOSS_BASE_FORM_B_TEMPLATE, "损耗费计费基数（按栋）", "", Group.TENANT, S_TENANT, "from", false, ValueKind.ENUM, LOSS_BASE_FORM_OPTS,
            "同「损耗费计费基数（形态）」，仅对该栋所在损耗组生效，优先于整户设置", "邓宇峰：三车间组 F、六车间组默认", null);
        price("loss_base_park_meter", "损耗基数附加电表", "", Group.TENANT, S_TENANT, "from", false, ValueKind.REF_METER, null,
            "损耗费基数附加该电表电费（度数 × 平段电价；有按月附加金额则用金额）", "永龙 反向有功表", null);
    }

    /** 未注册 → null;loss_base_form_b{楼栋id} 按前缀命中模板 */
    public static Def get(String key) {
        if (key == null) return null;
        Def d = DEFS.get(key);
        if (d == null && LOSS_BASE_FORM_B.matcher(key).matches()) d = DEFS.get(LOSS_BASE_FORM_B_TEMPLATE);
        return d;
    }

    public static Collection<Def> all() { return Collections.unmodifiableCollection(DEFS.values()); }

    /** 键存在且 scope 形态允许('' 全园 / p{n}|dorm 期 / building:{id} / meter:{id} / rule:{id} / tenant:{id}) */
    public static boolean allowed(String key, String scope) {
        Def d = get(key);
        if (d == null) return false;
        ScopeKind k = scopeKind(scope);
        return k != null && d.scopes().contains(k);
    }

    public static String defaultMode(String key) {
        Def d = get(key);
        return d == null ? null : d.defaultMode();
    }

    public static Table tableOf(String key) {
        Def d = get(key);
        return d == null ? null : d.table();
    }

    /** 该表的全部注册键(PriceCfgService 白名单 = keysOf(PRICE)) */
    public static Set<String> keysOf(Table t) {
        Set<String> out = new LinkedHashSet<>();
        for (Def d : DEFS.values()) if (d.table() == t) out.add(d.key());
        return out;
    }

    /** scope 字符串 → 形态;非法(如 'px'、'building:x')→ null */
    public static ScopeKind scopeKind(String scope) {
        if (scope == null || scope.isEmpty()) return ScopeKind.GLOBAL;
        if (scope.matches(ZoneService.ZONE_REGEX)) return ScopeKind.ZONE;
        int i = scope.indexOf(':');
        if (i <= 0 || !scope.substring(i + 1).matches("\\d+")) return null;
        return switch (scope.substring(0, i)) {
            case "building" -> ScopeKind.BUILDING;
            case "meter" -> ScopeKind.METER;
            case "rule" -> ScopeKind.RULE;
            case "tenant" -> ScopeKind.TENANT;
            default -> null;
        };
    }
}
