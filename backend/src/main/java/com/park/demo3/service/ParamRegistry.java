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
        0, "正常核算（损耗 = 分表合计 − 总表）",
        1, "纯公摊（率 = 公摊度数 ÷ 总表 + 加点）",
        2, "不核算（只陈列度数）");
    private static final Map<Integer, String> LOSS_BASE_FORM_OPTS = Map.of(
        1, "A：电费 + 公摊 + 管理费",
        2, "B：电费 + 公摊（默认）",
        3, "C：电费 + 容量费",
        6, "F：电费 + 公摊（去电梯）+ 管理费",
        7, "G：电费 + 公摊 + 管理费 + 园区表电费");

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
        String elecF = "电费 = 用量 × (裸电价 + 电力管理费)；缺当月电价整期不生成";
        price("elec_commercial", "商业裸电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            elecF, "代理购电逐月变；一期公摊池成本与损耗费单价的底价", null);
        price("elec_peak", "峰段裸电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            elecF, "代理购电逐月变", null);
        price("elec_sharp", "尖段裸电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            elecF, "名义价；实收按「尖峰按尖价收取比率」折算", null);
        price("elec_flat", "平段裸电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            elecF, "代理购电逐月变；二期公摊池成本与损耗费单价的底价", null);
        price("elec_valley", "谷段裸电价", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            elecF, "代理购电逐月变", null);
        price("elec_resident", "居民裸电价（宿舍）", "元/度", Group.MONTHLY, S_GLOBAL_ZONE, "month", true, ValueKind.MONEY, null,
            elecF, "单一价", null);
        price("sharp_as_peak_ratio", "尖峰按尖价收取比率", "比率", Group.MONTHLY, S_GLOBAL_ZONE_TENANT, "from", true, ValueKind.RATE, null,
            "尖段实收单价 = 尖价 × 比率 + 峰价 × (1 − 比率)", "政策开关：0 = 尖段全按峰价收；二期 2023 下半年 1→0.0994→0；可按户设", null);
        price("elevator_area_base", "A座电梯面积基数", "㎡", Group.MONTHLY, S_ZONE, "from", true, ValueKind.NUMBER, null,
            "A座电梯分摊标准 = 电梯池成本 ÷ 面积基数（元/㎡）", "源册逐月手改（2023 下半年四个值）；本月无专属值即沿用上一版本", null);
        alloc("loss_adj_qty", "损耗调整度数", "度", Group.MONTHLY, S_BUILDING, "month", true, ValueKind.NUMBER, null,
            "收取率 = −(分表合计 − 总表 − 公摊度数 − 调整度数) ÷ 分母 + 加点", "正数=多收（加大损耗），负数=少收；按楼栋组头设，仅当月", null);
        alloc("loss_rate_manual", "手工收取损耗率", "比率", Group.MONTHLY, S_BUILDING, "month", true, ValueKind.RATE, null,
            "填了就直接用它作收取损耗率，公式算出的率并排备查", "源册手填常量的统一出口（如 B座 0.0156、二三四车间 0.0015）", null);
        alloc("extra_qty", "池加度 / 扣度", "度", Group.MONTHLY, S_RULE, "month", true, ValueKind.NUMBER, null,
            "池净量 = Σ绑定表用量 + 加度（扣度填负数）", "招商中心净电 2023-12 −1470 / 2024-02 −670；货梯 +170 / +100 / +200（2023-12 起）", null);
        alloc("manual_qty", "池手输用量", "度或吨", Group.MONTHLY, S_RULE, "month", true, ValueKind.NUMBER, null,
            "无表池：用量直接取手输值，不读电表", "宿舍绿化水 84 吨", null);
        price("loss_base_park_amount", "损耗基数：园区表金额（照抄册面）", "元", Group.MONTHLY, S_TENANT, "month", true, ValueKind.MONEY, null,
            "损耗费基数 = 户电费 + 公摊 + 管理费 + 本金额（形态 G）", "永龙：逐月照抄源册金额；无值时按园区表度数 × 平段价推", null);

        // ── ② 长期常数(默认 from) spec §3.2 ──
        price("mgmt_fee", "电力管理费（分时 / 居民）", "元/度", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "电费单价 = 裸电价 + 电力管理费", "全园 0.16；户级例外 0.15 / 0.10 / 0（与商业维护费成对写）", "mgmt_fee_commercial");
        price("mgmt_fee_commercial", "商业维护费", "元/度", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "商业电费单价 = 商业裸电价 + 商业维护费", "全园 0.32；一期公摊池与损耗费单价同口径", null);
        price("capacity_fee", "装机容量费", "元/kVA·月", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "容量费 = 装机容量(kVA) × 单价（按合同天数折算）", "22.6（2023-08 为 23）；可莱恩 / 芷泉 23 户级", null);
        price("water", "水价", "元/吨", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "水费 = 用水量 × (水价 + 水管网维护费)", "全园 3.95；宿舍 3.85；包干户 4.45（配套管网费 0）", null);
        price("water_pipe", "水管网维护费", "元/吨", Group.CONSTANT, S_GLOBAL_ZONE_TENANT, "from", false, ValueKind.MONEY, null,
            "水费 = 用水量 × (水价 + 水管网维护费)", "全园 0.5；宿舍 0", null);
        price("lamp_area_base", "路灯面积基数", "㎡", Group.CONSTANT, S_GLOBAL_ZONE, "from", false, ValueKind.NUMBER, null,
            "路灯分摊标准 = 路灯池成本 ÷ 面积基数（元/㎡）", "一期 80000；宿舍 15510", null);
        price("green_area_base", "绿化面积基数", "㎡", Group.CONSTANT, S_GLOBAL_ZONE, "from", false, ValueKind.NUMBER, null,
            "绿化水分摊标准 = 绿化水池成本 ÷ 面积基数（元/㎡）", "一期 80000", null);
        price("area_base", "园区面积基数", "㎡", Group.CONSTANT, S_GLOBAL_ZONE, "from", false, ValueKind.NUMBER, null,
            "园区级池（消防设施 / 路灯 / 绿化泵）分摊标准 = 池成本 ÷ 园区面积基数", "二期 148918.01", null);
        alloc("park_share_div", "一期园区公共电均摊栋数", "栋", Group.CONSTANT, S_ZONE, "from", false, ValueKind.INT, null,
            "公摊分摊度数 = ROUND(Σ园区公摊池当月净量 ÷ 均摊栋数, 2)", "6（五个月不变）", null);
        alloc("loss_adj_rate", "损耗加点", "比率", Group.CONSTANT, S_BUILDING, "from", false, ValueKind.RATE, null,
            "收取率 = 公式率 + 加点", "一期 0.003（F座曾 0.005）2023-10 起；二期 0.002；按楼栋组头设", null);
        alloc("coefficient", "池分母（层数 T / 受益面积Σ）", "", Group.CONSTANT, S_RULE, "from", false, ValueKind.NUMBER, null,
            "分摊标准 = 池成本（或用量）÷ 分母", "唯一存放处；有面积基数键的池不用它（分母走对应面积基数）", null);
        alloc("std_add", "池分摊标准末端加价", "元", Group.CONSTANT, S_RULE, "from", false, ValueKind.MONEY, null,
            "分摊标准 = 算式值 + 末端加价", "广联 +100", null);
        alloc("price_override", "池单价覆盖", "元/度", Group.CONSTANT, S_RULE, "from", false, ValueKind.MONEY, null,
            "池成本 = 用量 × 覆盖单价（不走价目簿）", "宿舍路灯 1.13156875 化石价 / 绿化水 4.45", null);

        // ── ③ 核算口径(结构性,默认 from;栋级人话句子) spec §3.3 ──
        alloc("loss_variant", "损耗核算方式", "", Group.RULE, S_BUILDING, "from", false, ValueKind.ENUM, LOSS_VARIANT_OPTS,
            "正常核算：率 = −(分表合计 − 总表 − 公摊度数 − 调整度数) ÷ 分母 + 加点；纯公摊：率 = 公摊度数 ÷ 分母 + 加点",
            "B座 / C座 2023-11 起纯公摊；G座 不核算", null);
        alloc("loss_head", "并入他栋计损", "", Group.RULE, S_BUILDING, "from", false, ValueKind.REF_BUILDING, null,
            "与所指楼栋合并成一组、共用一块总表计损；指向自身 = 独立核算", "二期 二 / 四车间并入三车间；一车间 2023-08/09 并入五车间", null);
        alloc("loss_c_meter", "组总表只认这一块表", "", Group.RULE, S_BUILDING, "from", false, ValueKind.REF_METER, null,
            "该栋总表读数只取所指的表，其余总表既不入总表也不入分表合计", "A座 只认「A座总电」", null);
        alloc("loss_recon", "参与供电侧对账", "", Group.RULE, S_BUILDING, "from", false, ValueKind.BOOL, null,
            "是否参与「供电侧总表 vs 单元合计」两行对账", "A座 独立供电链路，不参与", null);
        alloc("loss_exclude", "剔出所在栋的合计", "", Group.RULE, S_METER, "from", false, ValueKind.BOOL, null,
            "该表不计入所在栋的总表 / 分表合计", "抄表册段落合计明确剔除的行（力美C201电 / 四车间工地 / 广告字分表）", null);
        alloc("loss_denom_cable", "损耗率分母含铝缆", "", Group.RULE, S_ZONE_BUILDING, "from", false, ValueKind.BOOL, null,
            "开：分母 = 总表 + 铝缆；关：分母 = 总表", "二期 2023-08/09 含铝缆，2023-10 起只取总表；期或栋级", null);
        alloc("loss_supply_meter", "供电侧对账总表", "", Group.RULE, S_ZONE, "from", false, ValueKind.REF_METER, null,
            "对账供给边 = 所指总表的读数（该表不入任何损耗组）", "一期 B-G座总电；二期 二期总电", null);
        alloc("frozen_2023", "2023 冻结价（不参与计算）", "元", Group.RULE, S_RULE, "from", false, ValueKind.MONEY, null,
            "只作披露：该池在原册的 2023 冻结价，引擎不读", "隐藏死模板 公共电分摊!M99/M109/L24/L99", null);

        // ── ④ 户级例外类(仅户级) spec §3.4 ──
        price("elec_package", "包干电价", "元/度", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "电费 = 用量 × 包干价（已含管理费，配套管理费双键 = 0）", "包干户 1.0 / 商铺 1.5", null);
        price("share_elec_fixed", "公共用电包干额", "元/月", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "替代「楼层公共 + 电梯 + 路灯」三项公摊，按月固定额", "孵化协议固定收取", null);
        price("share_water_fixed", "公共用水包干额", "元/月", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "替代「绿化水」公摊，按月固定额", "孵化协议固定收取", null);
        price("green_rate", "绿化水收取价", "元/㎡", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "绿化水公摊 = 面积 × 收取价（无户级值 = 当月池核算率）", "0.01 组约 37 户（沿用旧模板）", null);
        price("lamp_rate", "路灯收取价", "元/㎡", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "路灯公摊 = 面积 × 收取价（无户级值 = 当月池核算率）", "旧口径 0.005 户", null);
        price("fire_amount_fixed", "消防照明固定额", "元", Group.TENANT, S_TENANT, "from", false, ValueKind.MONEY, null,
            "消防照明按固定额收取；0 = 免收", "曹小芳 / 刘彪 照抄旧值 175.48 / 72.59", null);
        price("loss_base_form", "损耗费基数形态", "", Group.TENANT, S_TENANT, "from", false, ValueKind.ENUM, LOSS_BASE_FORM_OPTS,
            "损耗费 = 基数 × 收取损耗率；基数按形态圈行", "整户；按楼栋链另设见「损耗费基数形态（按栋）」", null);
        price(LOSS_BASE_FORM_B_TEMPLATE, "损耗费基数形态（按栋）", "", Group.TENANT, S_TENANT, "from", false, ValueKind.ENUM, LOSS_BASE_FORM_OPTS,
            "同「损耗费基数形态」，只对该楼栋所在损耗链生效，优先于整户设置", "邓宇峰：三车间链 F、六车间链默认", null);
        price("loss_base_park_meter", "损耗基数：园区表", "", Group.TENANT, S_TENANT, "from", false, ValueKind.REF_METER, null,
            "损耗费基数附加所指园区表的电费（度数 × 平段价；有照抄金额则用金额）", "永龙 反向有功表", null);
    }

    /** 未注册 → null;loss_base_form_b{楼栋id} 按前缀命中模板 */
    public static Def get(String key) {
        if (key == null) return null;
        Def d = DEFS.get(key);
        if (d == null && LOSS_BASE_FORM_B.matcher(key).matches()) d = DEFS.get(LOSS_BASE_FORM_B_TEMPLATE);
        return d;
    }

    public static Collection<Def> all() { return Collections.unmodifiableCollection(DEFS.values()); }

    /** 键存在且 scope 形态允许('' 全园 / p1|p2|dorm 期 / building:{id} / meter:{id} / rule:{id} / tenant:{id}) */
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

    /** scope 字符串 → 形态;非法(如 'p9'、'building:x')→ null */
    public static ScopeKind scopeKind(String scope) {
        if (scope == null || scope.isEmpty()) return ScopeKind.GLOBAL;
        if (scope.equals("p1") || scope.equals("p2") || scope.equals("dorm")) return ScopeKind.ZONE;
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
