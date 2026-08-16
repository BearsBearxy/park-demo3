package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import static java.util.stream.Collectors.groupingBy;

// 公摊分摊与损耗(PB-ALLOCATION-SPEC)。用量唯一来源=meter_reading 派生(MeterService.usage 静态公式复用),
// 本刀只做「规则结构化+金额化+快照落库+对账」薄计算层;户级缴费单/实收核销是 P-C。
// 防耦合边界(spec §5):跨域读一律注 mapper(Meter/MeterReading/Tenant/Building/Contract/ElecCostEntry),
// 写只碰自己的四张表(alloc_rule/alloc_rule_member+alloc_rule_meter/alloc_cfg/alloc_result)。
// 快照口径:分摊金额是要变成催缴账单的钱,生成时快照(rate_snap/price_snap);读数事后重导不让已出账数字漂移。
@Service
public class AllocService {
    private static final Pattern YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");
    // share_water 占位首版不生成(真实数据量不成刀,spec §7)
    private static final String FEE_LOSS = "share_elec_loss";
    // 刀二:电梯池首层桶不摊(纸约+B座货梯先例);只这一个费键走 skipFirstFloor
    static final String FEE_ELEVATOR = "share_elec_elevator";

    private final AllocRuleMapper rules;
    private final AllocRuleMeterMapper ruleMeters;
    private final AllocRuleMemberMapper ruleMembers;
    private final AllocRuleLinkMapper ruleLinks;
    private final AllocCfgMapper cfgs;
    private final AllocResultMapper results;
    private final AllocPoolResultMapper poolResults;
    private final AllocPoolMeterResultMapper poolMeterResults;   // V73 逐表明细快照(原册一表一行)
    private final AllocLossResultMapper lossResults;
    private final MeterMapper meters;
    private final MeterReadingMapper readings;
    private final TenantMapper tenants;
    private final BuildingMapper buildings;
    private final ContractMapper contracts;
    private final ContractBillingTermMapper billingTerms;   // S5 §1:分摊面积改读租金计费行(只读)
    private final BillingTermUnitMapper termUnits;   // 刀2:计费行↔单元绑定(V91),层定位 area 池的楼层面积口径
    private final UnitMapper units;                  // V69 受益人候选:楼栋+楼层 → 单元 → 合同 → 租户
    private final ContractUnitMapper contractUnits;
    private final ElecCostEntryMapper elecEntries;   // 互认提示行只读(单向:P-B 永不写 elec_cost)
    private final PriceCfgService priceCfg;          // 池引擎取价单一事实源(POOL-ENGINE-SPEC §3)

    public AllocService(AllocRuleMapper rules, AllocRuleMeterMapper ruleMeters, AllocRuleMemberMapper ruleMembers,
                        AllocRuleLinkMapper ruleLinks, AllocCfgMapper cfgs, AllocResultMapper results,
                        AllocPoolResultMapper poolResults, AllocPoolMeterResultMapper poolMeterResults,
                        AllocLossResultMapper lossResults, MeterMapper meters,
                        MeterReadingMapper readings, TenantMapper tenants, BuildingMapper buildings,
                        ContractMapper contracts, ContractBillingTermMapper billingTerms,
                        BillingTermUnitMapper termUnits,
                        UnitMapper units, ContractUnitMapper contractUnits,
                        ElecCostEntryMapper elecEntries, PriceCfgService priceCfg) {
        this.rules = rules; this.ruleMeters = ruleMeters; this.ruleMembers = ruleMembers; this.ruleLinks = ruleLinks;
        this.cfgs = cfgs; this.results = results; this.poolResults = poolResults;
        this.poolMeterResults = poolMeterResults; this.lossResults = lossResults;
        this.meters = meters; this.readings = readings;
        this.tenants = tenants; this.buildings = buildings; this.contracts = contracts;
        this.billingTerms = billingTerms; this.termUnits = termUnits;
        this.units = units; this.contractUnits = contractUnits;
        this.elecEntries = elecEntries; this.priceCfg = priceCfg;
    }

    // ══ V69 池定位与受益人(用户 2026-07-30 拍板:池名不手写/受益人勾选+按月留痕) ══

    private static boolean blank(String s) { return s == null || s.isBlank(); }

    // 池名自动生成:非空段以「·」连接;楼层+侧向合成一段(四楼+西侧=四楼西侧);楼栋名原样保留(含空格)。
    // ⚠楼栋空(园区级池)前缀必须取 **zone 期别** 而不是统一写"园区级":二期/一期/宿舍区各有一个「路灯」池,
    //   统一前缀会让三个池撞成同一个名字(V70 加期别前缀正是为此)。与 derive_pool_location.py 同源。
    // 例:poolName("一期 A座","四楼","西侧","走廊灯")="一期 A座·四楼西侧·走廊灯";poolName(null,…,"路灯",zone=p1)="一期园区·路灯"
    private static final Map<String, String> ZONE_POOL_PREFIX =
        Map.of("p1", "一期园区", "p2", "二期园区", "dorm", "宿舍区");
    public static String poolName(String zone, String buildingName, String floorLabel, String side, String feeName) {
        StringBuilder sb = new StringBuilder(blank(buildingName)
            ? ZONE_POOL_PREFIX.getOrDefault(zone, "园区级") : buildingName.trim());
        String loc = (blank(floorLabel) ? "" : floorLabel.trim()) + (blank(side) ? "" : side.trim());
        if (!loc.isEmpty()) sb.append('·').append(loc);
        if (!blank(feeName)) sb.append('·').append(feeName.trim());
        return sb.length() > 64 ? sb.substring(0, 64) : sb.toString();   // name VARCHAR(64)
    }

    private static final String CN_DIGITS = "零一二三四五六七八九";

    // 楼层名→unit.floor 整数("四楼"=4/"负一层"=-1/"3楼"=3/"天面"=null 非楼层)。仅用于受益人候选过滤与排序。
    public static Integer floorNum(String label) {
        if (blank(label)) return null;
        String s = label.trim();
        boolean neg = s.startsWith("负") || s.startsWith("地下") || s.startsWith("-");
        s = s.replaceAll("[^0-9零一二三四五六七八九十]", "");
        if (s.isEmpty()) return null;
        int n = s.chars().allMatch(Character::isDigit) ? Integer.parseInt(s) : cnNum(s);
        return n == 0 ? null : neg ? -n : n;
    }

    private static int cnNum(String s) {
        int t = s.indexOf('十');
        if (t < 0) return Math.max(CN_DIGITS.indexOf(s.charAt(0)), 0);
        int tens = t == 0 ? 1 : Math.max(CN_DIGITS.indexOf(s.charAt(t - 1)), 0);
        int ones = t == s.length() - 1 ? 0 : Math.max(CN_DIGITS.indexOf(s.charAt(t + 1)), 0);
        return tens * 10 + ones;
    }

    // 受益人版本组前滚(S14,对齐价目 tenant_price_cfg):取 acct_month≤ym 的最大版本组整组快照替换,
    // ''=初始版最小——03 版本组自动沿用到 04/05…直到更晚版本覆盖,重生成历史月取历史版本组。
    // ''(空串)字典序恒小于 'YYYY-MM',天然满足「初始版最小」;全部行都在未来(>ym)= 空名单。
    static List<AllocRuleMember> pickMembers(List<AllocRuleMember> rows, String ym) {
        String best = rows.stream().map(m -> m.getAcctMonth() == null ? "" : m.getAcctMonth())
            .filter(am -> am.compareTo(ym) <= 0).max(Comparator.naturalOrder()).orElse(null);
        return best == null ? List.of()
            : rows.stream().filter(m -> best.equals(m.getAcctMonth() == null ? "" : m.getAcctMonth())).toList();
    }

    List<AllocRuleMember> resolveMembers(Integer ruleId, String ym) {
        return pickMembers(ruleMembers.selectByRule(ruleId), ym);
    }

    // 园区级池(building_id IS NULL)无显式受益人 → 受益人自动=该 zone 全园在租名册(用户 2026-07-30 拍板)。
    // 只对能摊到户的按面积/按层生效:direct 要恰一户(全园名册无意义)、none/ref/loss 本就不摊。
    // 一处判定三处用(引擎 memberAmounts / 池表 autoMembers 标 / member-diff 降噪),防三份口径漂移。
    static boolean autoMembers(AllocRule r, boolean noExplicitMember) {
        return noExplicitMember && r.getBuildingId() == null
            && ("area".equals(r.getMethod()) || "floor".equals(r.getMethod()));
    }

    // zone → 当月在租租户(在租语义=Roster,即 MeterBindingService.covers,不另写一份)。
    // 户的期别取「在租合同挂的楼栋」的 zone,zone 由该栋的表定 —— 宿舍楼 phase=1 但 zone=dorm,用 phase 会把宿舍归进一期。
    // 多场地户(仁恒/碳紫型)可同时入两期名册,各期池各摊一次。
    static Map<String, List<Integer>> inForceByZone(List<Contract> covering,
                                                    Map<Integer, List<Unit>> unitsByContract,
                                                    Map<Integer, String> zoneOfBuilding) {
        Map<String, LinkedHashSet<Integer>> acc = new LinkedHashMap<>();
        for (Contract c : covering) {
            List<Integer> bids = new ArrayList<>();
            if (c.getBuildingId() != null) bids.add(c.getBuildingId());
            for (Unit u : unitsByContract.getOrDefault(c.getId(), List.of()))
                if (u.getBuildingId() != null) bids.add(u.getBuildingId());
            for (Integer bid : bids) {
                String z = zoneOfBuilding.get(bid);
                if (z != null) acc.computeIfAbsent(z, k -> new LinkedHashSet<>()).add(c.getTenantId());
            }
        }
        Map<String, List<Integer>> out = new HashMap<>();
        acc.forEach((z, ids) -> out.put(z, new ArrayList<>(ids)));
        return out;
    }

    // 自动名册的户面积必须**按期别切**:一份合同的面积只算进它自己那栋所在的 zone。
    // 否则多场地户(邓宇峰=二期六车间厂房+宿舍房间、思汗=F座厂房+宿舍)的厂房面积会被重复计进每个期别池,
    // 宿舍池按 68988㎡ 而非 10585㎡ 摊 → 路灯多摊 4 倍(V70 bug)。
    // 合同集=名册同一份 covering(月有效),不用 status='active':active 是"今天"的状态,
    // 历史月的有效段常是 renewed(如 S10-0069#1 覆盖 2024-02 却标 renewed),且同一单元的多个续签段会叠加重算。
    // 面积不按栋二拆:同合同挂到外区的附加单元不把面积带过去(4892㎡ 厂房合同挂个宿舍房间 ≠ 宿舍面积)。
    // S5 §1:面积口径改 Σ租金计费行(area+IFNULL(area_shared,0)),经 allocArea 统一解析(无租金行回退 rent_area)。
    // S15 §4 面积污染根修:宿舍计费行(dormTerm)面积不跟合同主楼栋走,直落该户 dorm zone 基数
    // (双成 p1 路灯基数 448.01→416、邓宇峰 p2 4892.89→4644.10);非宿舍行照旧按主楼栋 zone。
    // 边界(汤周杰型):主楼栋=宿舍楼但含厂房行的合同,厂房行仍按主楼栋 zone(=dorm)——主楼栋挂错是数据错,
    // 由 SQL 刀改对主楼栋,引擎不做 location 猜测。
    static Map<String, Map<Integer, BigDecimal>> areaByZoneTenant(List<Contract> covering,
                                                                  Map<Integer, List<Unit>> unitsByContract,
                                                                  Map<Integer, String> zoneOfBuilding,
                                                                  Map<Integer, BigDecimal> rentLineArea,
                                                                  Map<Integer, BigDecimal> dormLineArea,
                                                                  Set<Integer> fallback) {
        Map<String, Map<Integer, BigDecimal>> out = new HashMap<>();
        for (Contract c : covering) {
            if (c.getTenantId() == null) continue;
            BigDecimal dormArea = dormLineArea.get(c.getId());
            if (dormArea != null)
                out.computeIfAbsent("dorm", k -> new HashMap<>()).merge(c.getTenantId(), dormArea, BigDecimal::add);
            BigDecimal area = allocArea(c, rentLineArea, dormLineArea, fallback);
            if (area == null) continue;
            Integer bid = c.getBuildingId();
            if (bid == null)   // 只挂单元的合同:取首个单元的栋(与 inForceByZone 同源,面积只落一处)
                bid = unitsByContract.getOrDefault(c.getId(), List.of()).stream()
                    .map(Unit::getBuildingId).filter(Objects::nonNull).findFirst().orElse(null);
            String z = bid == null ? null : zoneOfBuilding.get(bid);
            if (z != null)
                out.computeIfAbsent(z, k -> new HashMap<>()).merge(c.getTenantId(), area, BigDecimal::add);
        }
        return out;
    }

    // S15 §4:宿舍计费行判定(段类型 dorm,或段类型缺省但费项=宿舍租金)。BillNoticeService 拆场地比例同口径。
    static boolean dormTerm(ContractBillingTerm t) {
        return "dorm".equals(t.getPropertyType()) || "rent_dorm".equals(t.getFeeKey());
    }

    // S5 §1 分摊面积单一口径:该合同 Σ非宿舍租金计费行(area+IFNULL(area_shared,0))(rentLineArea 已按
    // BUILDING_RENT_KEYS 预聚合并剔除 dormTerm 行,S15 §4);纯宿舍合同(只有 dorm 租金行)返回 null 且
    // **不回退 rent_area**——面积已全在 dorm 路,回退会双计;完全无租金计费行才回退 contract.rent_area
    // 并记名(fallback → loadCtx 收成一条 warn),两个消费点(自动名册/显式成员)共用。
    static BigDecimal allocArea(Contract c, Map<Integer, BigDecimal> rentLineArea,
                                Map<Integer, BigDecimal> dormLineArea, Set<Integer> fallback) {
        BigDecimal a = rentLineArea.get(c.getId());
        if (a != null) return a;
        if (dormLineArea.containsKey(c.getId())) return null;
        if (c.getRentArea() != null) fallback.add(c.getId());
        return c.getRentArea();
    }

    // 刀2(2026-08-09)跨楼层公摊:层定位 area 池的户面积口径 —— 该户租金计费行经 billing_term_unit
    // 绑到「某栋某层 unit」的行 Σ(area+IFNULL(area_shared,0))。同一行绑同层多房只计一次(217、218、219 型);
    // 跨层行(G座1-4层型)每层各计全额:行面积无层拆分依据,不硬猜(现库此类行只在无层定位池的楼栋,零影响)。
    // 只吃 covering 合同的行(与 areaByBuildingTenant 同口径);产物:building → floor → tenant → Σ面积。
    static Map<Integer, Map<Integer, Map<Integer, BigDecimal>>> rentAreaByBuildingFloor(
            List<BillingTermUnit> binds, Map<Integer, ContractBillingTerm> rentTermById,
            Map<Integer, Integer> tenantOfCoveringContract, Map<Integer, Unit> unitById) {
        Map<Integer, Map<Integer, Map<Integer, BigDecimal>>> out = new HashMap<>();
        Set<String> seen = new HashSet<>();
        for (BillingTermUnit b : binds) {
            ContractBillingTerm t = rentTermById.get(b.getTermId());
            if (t == null) continue;                                   // 非租金行不入面积
            Integer tenantId = tenantOfCoveringContract.get(t.getContractId());
            if (tenantId == null) continue;                            // 非当月覆盖合同
            Unit u = unitById.get(b.getUnitId());
            if (u == null || u.getBuildingId() == null || u.getFloor() == null) continue;
            if (!seen.add(b.getTermId() + "|" + u.getBuildingId() + "|" + u.getFloor())) continue;
            out.computeIfAbsent(u.getBuildingId(), k -> new HashMap<>())
                .computeIfAbsent(u.getFloor(), k -> new HashMap<>())
                .merge(tenantId, nz(t.getArea()).add(nz(t.getAreaShared())), BigDecimal::add);
        }
        return out;
    }

    // 该户在该栋是否有任何租金行绑定(无绑定 → 层定位池回退整栋口径,渐进不许凭空变 0)
    private static boolean boundInBuilding(Map<Integer, Map<Integer, BigDecimal>> floors, Integer tenantId) {
        for (Map<Integer, BigDecimal> f : floors.values()) if (f.containsKey(tenantId)) return true;
        return false;
    }

    private static AllocRuleMember autoMember(Integer tenantId) {
        AllocRuleMember m = new AllocRuleMember();
        m.setTenantId(tenantId);   // weight=null:area 按户面积;floor 走层内面积二拆
        return m;
    }

    // ── 纯函数公式核(§2,单测锁锚点) ──
    static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    static BigDecimal r2(BigDecimal v) { return v.setScale(2, RoundingMode.HALF_UP); }
    static BigDecimal r4(BigDecimal v) { return v.setScale(4, RoundingMode.HALF_UP); }

    // 二期分时金额 W=ROUND(Σ各分时用量×分时价,2)(W4=141.27 型);null 段=0
    public static BigDecimal touAmount(BigDecimal sharp, BigDecimal peak, BigDecimal flat, BigDecimal valley,
                                       BigDecimal pSharp, BigDecimal pPeak, BigDecimal pNorm, BigDecimal pValley) {
        return r2(nz(sharp).multiply(nz(pSharp)).add(nz(peak).multiply(nz(pPeak)))
            .add(nz(flat).multiply(nz(pNorm))).add(nz(valley).multiply(nz(pValley))));
    }

    // 二期「先金额后除层」标准(V10=145.37;四车间电梯 3/4 折用等效系数 6 复现,不建折扣字段)
    public static BigDecimal unitStd(BigDecimal touAmt, BigDecimal coefficient) {
        if (coefficient == null || coefficient.signum() == 0) return null;
        return r2(touAmt.divide(coefficient, 10, RoundingMode.HALF_UP));
    }

    // 收取租户损耗率 I(POOL-ENGINE-SPEC §3.4):变体按座配置(loss_variant),不按 E 符号推断
    // (审计:一期F座 E=+55.7 仍净额式)。net:I=−ROUND((E−G−adjQty)/C,4)+adjRate;
    // share_only:I=ROUND(G/C,4)+adjRate。C=总表量,E=分表Σ−总表,G 已含 g_adj。
    public static BigDecimal tenantLossRate(String variant, BigDecimal lossQty, BigDecimal shareQty,
                                            BigDecimal adjQty, BigDecimal adjRate, BigDecimal headQty) {
        if (headQty == null || headQty.signum() == 0) return null;
        BigDecimal base = "share_only".equals(variant)
            ? r4(nz(shareQty).divide(headQty, 10, RoundingMode.HALF_UP))
            : r4(lossQty.subtract(nz(shareQty)).subtract(nz(adjQty))
                .divide(headQty, 10, RoundingMode.HALF_UP)).negate();
        return base.add(nz(adjRate));
    }

    // ── 池引擎纯函数(POOL-ENGINE-SPEC §3,单测锁 2024-02 锚点) ──
    static BigDecimal rn(BigDecimal v, int scale) { return v.setScale(scale, RoundingMode.HALF_UP); }

    // 二期未舍入分时金额(§3.2):尖码量按 尖×[r×尖价+(1−r)×峰价](2024-02 r=0→尖按峰价,复刻AB4);null 段=0
    public static BigDecimal p2Unrounded(BigDecimal sharp, BigDecimal peak, BigDecimal flat, BigDecimal valley,
                                         BigDecimal pSharp, BigDecimal pPeak, BigDecimal pFlat, BigDecimal pValley,
                                         BigDecimal sharpAsPeakRatio) {
        BigDecimal r = nz(sharpAsPeakRatio);
        BigDecimal sharpPrice = r.multiply(nz(pSharp)).add(BigDecimal.ONE.subtract(r).multiply(nz(pPeak)));
        return nz(sharp).multiply(sharpPrice).add(nz(peak).multiply(nz(pPeak)))
            .add(nz(flat).multiply(nz(pFlat))).add(nz(valley).multiply(nz(pValley)));
    }

    // 分摊标准三式(§3.3):未舍入值先除基数再 ROUND(复刻 Excel 算序);fold_price/std_add 末端叠加不再舍入
    public static BigDecimal stdAmountOverBase(BigDecimal unrounded, BigDecimal base, int scale,
                                               BigDecimal foldAdd, BigDecimal stdAdd) {
        if (base == null || base.signum() == 0) return null;
        return rn(unrounded.divide(base, 12, RoundingMode.HALF_UP), scale).add(nz(foldAdd)).add(nz(stdAdd));
    }

    public static BigDecimal stdQtyPriceOverBase(BigDecimal qty, BigDecimal extra, BigDecimal base, BigDecimal price,
                                                 int scale, BigDecimal foldAdd, BigDecimal stdAdd) {
        if (base == null || base.signum() == 0 || price == null) return null;
        return rn(nz(qty).add(nz(extra)).divide(base, 12, RoundingMode.HALF_UP).multiply(price), scale)
            .add(nz(foldAdd)).add(nz(stdAdd));
    }

    // 广告字档(度数/面积,量纲混用原样复刻)
    public static BigDecimal stdQtyOverBase(BigDecimal qty, BigDecimal base, int scale,
                                            BigDecimal foldAdd, BigDecimal stdAdd) {
        if (base == null || base.signum() == 0) return null;
        return rn(nz(qty).divide(base, 12, RoundingMode.HALF_UP), scale).add(nz(foldAdd)).add(nz(stdAdd));
    }

    // 户损耗费=ROUND(户用电量×I×price_loss,2)(§2.4.5)
    public static BigDecimal lossFee(BigDecimal tenantUsage, BigDecimal rate, BigDecimal priceLoss) {
        return r2(tenantUsage.multiply(rate).multiply(priceLoss));
    }

    // weight=NULL 层内按面积二拆:ROUND(元/层合计/层面积Σ×户面积,2)(H55 型)
    public static BigDecimal floorAreaSplit(BigDecimal perFloor, BigDecimal areaSum, BigDecimal tenantArea) {
        if (areaSum == null || areaSum.signum() == 0) return null;
        return r2(perFloor.divide(areaSum, 10, RoundingMode.HALF_UP).multiply(tenantArea));
    }

    // ── 刀D §D.2 按层分桶(纯函数,单测用真实数值直接喂,不必起服务) ──
    // 病根:旧实现把 weight=NULL 的成员**合摊一份** perFloor,于是 18 个按层池每月只摊出 1 份
    // (2024-02 少摊 7992.32 元)。新算法只在「分桶」这一层不同:桶从「全池一个」变成「一层一个」。
    public static final String FLOOR_UNKNOWN = "未定层";

    // 分桶入参:一户一条,floors=该户在本池楼栋解析出的楼层(§D.1,空=定不出),area=合同面积(口径不变)
    public record FloorMember(Integer tenantId, List<String> floors, BigDecimal area) {}
    // 分桶产出:amounts=每户金额(跨多层户=其各桶之和);unknownCount=「未定层」桶户数(>0 要落 warn)
    public record FloorSplit(Map<Integer, BigDecimal> amounts, int unknownCount) {}

    // 桶序:楼层号升序 → 非数字层(天面等) → 「未定层」永远垫底
    private static final Comparator<String> FLOOR_ORDER = Comparator
        .comparingInt((String f) -> FLOOR_UNKNOWN.equals(f) ? 2 : floorNum(f) == null ? 1 : 0)
        .thenComparingInt(f -> floorNum(f) == null ? 0 : floorNum(f))
        .thenComparing(f -> f);

    // 一户跨多层 → 进多个桶(电梯/楼梯间按层收,跨层户本就多用);定不出楼层 → 「未定层」桶
    public static Map<String, List<FloorMember>> floorBucketsOf(List<FloorMember> mems) {
        Map<String, List<FloorMember>> buckets = new TreeMap<>(FLOOR_ORDER);
        for (FloorMember m : mems) {
            List<String> fs = m.floors() == null || m.floors().isEmpty() ? List.of(FLOOR_UNKNOWN) : m.floors();
            for (String f : fs) buckets.computeIfAbsent(f, k -> new ArrayList<>()).add(m);
        }
        return buckets;
    }

    // 刀二:skipFirstFloor=true → 首层桶整桶剔除(纸约:首层租户不承担电梯维保费和维修费;
    // 源册先例 B座货梯 2/3/4F 各 1 份首层不摊)。只删桶不动成员解析:整户只在首层 → 无桶无金额。
    // 仅 share_elec_elevator 池的调用点开这个口;消防/楼层公共每层价含首层,照旧走旧签名。
    public static Map<String, List<FloorMember>> floorBucketsOf(List<FloorMember> mems, boolean skipFirstFloor) {
        Map<String, List<FloorMember>> buckets = floorBucketsOf(mems);
        // 首层判定走 floorNum(兼容 一楼/1楼/1F;库内词汇实测只有 一楼);「未定层」floorNum=null 不受影响
        if (skipFirstFloor) buckets.keySet().removeIf(f -> Integer.valueOf(1).equals(floorNum(f)));
        return buckets;
    }

    // 每桶(含「未定层」桶)独立分 1 份 perFloor:桶内 Σ面积>0 按面积拆,Σ面积=0 按户数均分。
    // 摊出总额可能 < 应分摊:coefficient(如 7 层)是账册固定分母,实际有人的层数少于它时差额=空置损失,不做补偿。
    public static FloorSplit floorBuckets(List<FloorMember> mems, BigDecimal perFloor) {
        return floorBuckets(mems, perFloor, false);
    }

    public static FloorSplit floorBuckets(List<FloorMember> mems, BigDecimal perFloor, boolean skipFirstFloor) {
        Map<String, List<FloorMember>> buckets = floorBucketsOf(mems, skipFirstFloor);
        Map<Integer, BigDecimal> amounts = new LinkedHashMap<>();
        for (List<FloorMember> bucket : buckets.values()) {
            BigDecimal areaSum = bucket.stream().map(m -> nz(m.area())).reduce(BigDecimal.ZERO, BigDecimal::add);
            for (FloorMember m : bucket) {
                BigDecimal amt = areaSum.signum() > 0
                    ? floorAreaSplit(perFloor, areaSum, nz(m.area()))
                    : r2(perFloor.divide(BigDecimal.valueOf(bucket.size()), 10, RoundingMode.HALF_UP));
                amounts.merge(m.tenantId(), amt, BigDecimal::add);
            }
        }
        return new FloorSplit(amounts, buckets.getOrDefault(FLOOR_UNKNOWN, List.of()).size());
    }

    // §D.6 分桶明细串:「按 3 层拆:二楼 1 户 / 三楼 1 户 / 未定层 2 户」(屏上「摊出」列 title)
    public static String floorNote(Map<String, List<FloorMember>> buckets) {
        if (buckets.isEmpty()) return null;
        return "按 " + buckets.size() + " 层拆:" + buckets.entrySet().stream()
            .map(e -> e.getKey() + " " + e.getValue().size() + " 户").collect(Collectors.joining(" / "));
    }

    // 层号→中文层名(floorNum 的逆):4→四楼、−1→负一层。
    // 分桶键必须归一:unit.floor=4 与户内表「4楼」「四楼」若各成一桶,同一层就会摊出两份。
    public static String floorLabelOf(int n) {
        int a = Math.abs(n);
        String cn = a < 10 ? String.valueOf(CN_DIGITS.charAt(a))
            : a == 10 ? "十"
            : a < 20 ? "十" + CN_DIGITS.charAt(a - 10)
            : a < 100 ? CN_DIGITS.charAt(a / 10) + "十" + (a % 10 == 0 ? "" : String.valueOf(CN_DIGITS.charAt(a % 10)))
            : String.valueOf(a);
        return n < 0 ? "负" + cn + "层" : cn + "楼";
    }

    // 楼层标签归一:能解析出层号的写成中文标准名;「天面」这类非数字层保留原文(floorNum=null)
    static String normFloor(String label) {
        Integer n = floorNum(label);
        return n == null ? label.trim() : floorLabelOf(n);
    }

    // §D.1 楼层两级回退(generate/读表时现算,**不落库**:楼层是主数据的派生,落到 alloc_rule_member 上
    // 就又多一份会漂的副本)。实测 2024-02:合同挂单元覆盖差(有效合同 121 挂/87 没挂),户内表覆盖好。
    //   1) 合同(覆盖本月)→ contract_unit → unit(building_id=池楼栋).floor —— 取**全部**楼层,跨多层就占多桶
    //   2) 上一步空 → 该户在本栋的户内电表 meter.floor_label(V74),同样取全部去重
    //   3) 仍为空 → 空列表 = 「未定层」桶(floorBuckets 归桶并计数)
    // §E4:两源各自的结果都留着 —— **优先级不变**(复核 2024-02:L1 覆盖的 21 条里绝大多数与 L2 一致
    // 或 L1 更全,如健明包装 L1=一楼+五楼、L2 只有一楼,反转会丢层),但两源都非空且不相等 = 主数据脏
    // (邓宇峰 unit_no='天面' 而 floor=1、电表说二楼),由调用方点名到户落 warn 请人去修。
    public record FloorSources(List<String> unit, List<String> meter) {
        // 实际入桶的那一份:L1 非空即 L1(§D.1 两级回退)
        public List<String> chosen() { return unit.isEmpty() ? meter : unit; }
        // 冲突=两源都有话说,且说的不是同一组楼层(与顺序无关)
        public boolean conflict() {
            return !unit.isEmpty() && !meter.isEmpty() && !new HashSet<>(unit).equals(new HashSet<>(meter));
        }
    }

    static FloorSources memberFloorSources(Integer tenantId, Integer buildingId,
                                           Map<Integer, List<Unit>> unitsByTenant,
                                           Map<Integer, List<Meter>> metersByTenant) {
        LinkedHashSet<String> byUnit = new LinkedHashSet<>(), byMeter = new LinkedHashSet<>();
        for (Unit u : unitsByTenant.getOrDefault(tenantId, List.of())) {
            if (buildingId != null && !buildingId.equals(u.getBuildingId())) continue;
            if (u.getFloor() != null) byUnit.add(floorLabelOf(u.getFloor()));
        }
        for (Meter m : metersByTenant.getOrDefault(tenantId, List.of())) {
            if (buildingId != null && !buildingId.equals(m.getBuildingId())) continue;
            if (!"tenant".equals(m.getOwnership()) || blank(m.getFloorLabel())) continue;
            byMeter.add(normFloor(m.getFloorLabel()));
        }
        return new FloorSources(new ArrayList<>(byUnit), new ArrayList<>(byMeter));
    }

    static List<String> memberFloor(Integer tenantId, Integer buildingId,
                                    Map<Integer, List<Unit>> unitsByTenant,
                                    Map<Integer, List<Meter>> metersByTenant) {
        return memberFloorSources(tenantId, buildingId, unitsByTenant, metersByTenant).chosen();
    }

    // ⭐告警点名(2026-08-14):聚合告警的「:甲、乙、丙 等」后缀。空集合返回空串(不留一个孤零零的冒号)。
    // 只列前 NAME_CAP 个 —— 125 个名字塞进一行提醒条谁也读不完,全量靠告警文案里指的那个筛选看。
    static final int NAME_CAP = 8;
    static String suffix(Collection<String> names) {
        List<String> ns = names.stream().filter(s -> s != null && !s.isBlank()).distinct().sorted().toList();
        if (ns.isEmpty()) return "";
        String head = String.join("、", ns.subList(0, Math.min(NAME_CAP, ns.size())));
        return ":" + head + (ns.size() > NAME_CAP ? " 等" : "");
    }

    // §E4 warn 文案(纯函数,单测直接喂;不冲突返回 null=不落 warn)
    static String floorConflictWarn(String poolName, String tenantName, FloorSources fs) {
        if (!fs.conflict()) return null;
        return "池「" + poolName + "」租户「" + tenantName + "」楼层两源不一致:合同单元="
            + String.join("+", fs.unit()) + "、户内表=" + String.join("+", fs.meter())
            + ",已按合同单元计;请核对主数据";
    }

    // §E5 warn 文案(纯函数;桶数未超账册分母返回 null=不落 warn)。
    // **不封顶**:rule 50 的超收(摊出 907.50 vs 应分摊 718.08)是账册用加度 170 度故意造的盈余,
    // 且 907.50 与账册已分摊 AE=907.5 吻合,一刀切封顶会打死这个已验证锚点 —— 只提醒,不动钱。
    static String floorCoefWarn(String poolName, int buckets, BigDecimal denom,
                                BigDecimal allocated, BigDecimal cost) {
        if (denom == null || BigDecimal.valueOf(buckets).compareTo(denom) <= 0) return null;
        return "池「" + poolName + "」按 " + buckets + " 层拆但账册分母为 "
            + denom.stripTrailingZeros().toPlainString() + " 层,摊出超应分摊 "
            + r2(allocated.subtract(cost)) + " 元,请核对系数或成员楼层";
    }

    // S13 §7 warn 文案(纯函数;差绝对值≤0.01 或无系数返回 null=不警)。不封顶不阻断:
    // 二/三/四车间 Σ层份<T 是账册刻意欠配(-2.26/-2.75/-2.30),差额=空置园区自担;>T 超配才真要人核对。
    static String weightCoefWarn(String poolName, BigDecimal weightSum, BigDecimal coefficient) {
        if (coefficient == null || weightSum.subtract(coefficient).abs().compareTo(new BigDecimal("0.01")) <= 0)
            return null;
        BigDecimal diff = weightSum.subtract(coefficient);
        return "池「" + poolName + "」Σ层份 " + weightSum.stripTrailingZeros().toPlainString()
            + " 与账册系数 T=" + coefficient.stripTrailingZeros().toPlainString()
            + " 差 " + diff.stripTrailingZeros().toPlainString()
            + (diff.signum() < 0 ? "(欠配层份=空置园区自担,账册刻意态)" : "(超配,请核对层份档案)");
    }

    // 户内表按户索引(停用表由调用方先剔除:ctx.meterById 已过滤,读表侧显式过滤)
    private static Map<Integer, List<Meter>> tenantMeters(Collection<Meter> live) {
        Map<Integer, List<Meter>> out = new HashMap<>();
        for (Meter m : live)
            if (m.getTenantId() != null) out.computeIfAbsent(m.getTenantId(), k -> new ArrayList<>()).add(m);
        return out;
    }

    // ── 年份(数据驱动:抄表年∪结果年——有读数即可生成,有结果即可回看) ──
    public List<Integer> years() {
        Set<Integer> ys = new TreeSet<>(readings.selectDistinctYears());
        ys.addAll(results.selectDistinctYears());
        return new ArrayList<>(ys);
    }

    // ── 规则 CRUD(整体保存:rule+meterIds+members 随行覆盖) ──
    // S21 §2.4:DTO 的 coefficient/extraQty 回传 alloc_cfg rule:{id} 版本链站在 ym 的生效值(ym 空=初始版本 '' 行,
    // 即旧「默认列」语义);两列不再存 alloc_rule。
    public List<AllocRuleDTO> ruleList(String zone, String ym) {
        Map<Integer, List<AllocRuleMeter>> mByRule = ruleMeters.selectList(null).stream()
            .collect(groupingBy(AllocRuleMeter::getRuleId));
        Map<Integer, List<AllocRuleMember>> memByRule = ruleMembers.selectList(null).stream()
            .collect(groupingBy(AllocRuleMember::getRuleId));
        Map<Integer, List<AllocRuleLink>> linkByDst = ruleLinks.selectList(null).stream()
            .collect(groupingBy(AllocRuleLink::getDstRuleId));
        List<AllocRule> all = rules.selectByZone(null);
        Map<Integer, String> nameById = new HashMap<>();
        for (AllocRule r : all) nameById.put(r.getId(), r.getName());
        Map<String, BigDecimal> cfg = cfgEffective(ym);
        return all.stream().filter(r -> zone == null || zone.equals(r.getZone()))
            .map(r -> toDTO(r, mByRule.getOrDefault(r.getId(), List.of()),
                memByRule.getOrDefault(r.getId(), List.of()),
                linkByDst.getOrDefault(r.getId(), List.of()), nameById, cfg)).toList();
    }

    // 站在 ym 的 (scope|key → 值) 扁平表;ym 空/null = 只取 '' 初始版本行
    private Map<String, BigDecimal> cfgEffective(String ym) {
        return VersionResolver.effectiveMap(cfgs.selectList(null).stream()
            .map(c -> new VersionResolver.Row(c.getScope(), c.getCfgKey(), c.getAcctMonth(), c.getMode(), c.getCfgValue(), c.getId()))
            .toList(), ym == null ? "" : ym);
    }

    @Transactional
    public AllocRuleDTO createRule(AllocRuleReq req) {
        validateRule(req, null);
        AllocRule r = new AllocRule();
        apply(r, req);
        r.setSortNo(rules.maxSortNo() + 1);
        rules.insert(r);
        saveChildren(r.getId(), req);
        // S21 §2.4 新建池例外:初始分母/初始加度落成 rule:{id} 的 '' from 行(同表同版本链);池建成后只在参数页改
        if (req.coefficient() != null)
            saveCfg(new AllocCfgReq("rule:" + r.getId(), "coefficient", "", req.coefficient(), "新建池初始分母", "from"));
        if (req.extraQty() != null && req.extraQty().signum() != 0)
            saveCfg(new AllocCfgReq("rule:" + r.getId(), "extra_qty", "", req.extraQty(), "新建池初始加度", "from"));
        return ruleById(r.getId());
    }

    @Transactional
    public AllocRuleDTO updateRule(Integer id, AllocRuleReq req) {
        AllocRule r = rules.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "规则不存在");
        validateRule(req, id);
        apply(r, req);   // 既有池:coefficient/extraQty 入参忽略,分母/加度只在参数页按版本改
        rules.updateById(r);
        ruleMeters.deleteByRule(id);
        ruleMembers.deleteByRuleMonth(id, memberMonth(req));   // 只覆盖目标月,其他月已出账口径不动
        saveChildren(id, req);
        return ruleById(id);
    }

    public void deleteRule(Integer id) {
        if (rules.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "规则不存在");
        if (results.countByRule(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该规则已有分摊结果,不可删除(历史月已快照)");
        rules.deleteById(id);   // 绑定表/受益人 FK 级联删
    }

    private void validateRule(AllocRuleReq req, Integer existingId) {
        // §E2 根因:基数二选一 —— baseKey 非空时基数取价目簿(computePool §1348 压根不读 coefficient),
        // 此时 coefficient 为 NULL 是正常态(V65 种子的 10 个 area 池即如此)。旧判据只认 coefficient,
        // 把这批池的任何编辑(改个费项也算)一律 400 挡掉。
        // S21 §2.4:分母只存 alloc_cfg rule:{id}.coefficient 版本链 —— 新建池看入参「初始分母」;既有池查参数表
        // (任一版本 >0 即可,入参 coefficient 不再是分母的来源)。
        if (("area".equals(req.method()) || "floor".equals(req.method())) && blank(req.baseKey())) {
            boolean ok = existingId == null
                ? req.coefficient() != null && req.coefficient().signum() > 0
                : cfgs.selectList(new QueryWrapper<AllocCfg>().eq("scope", "rule:" + existingId).eq("cfg_key", "coefficient"))
                    .stream().anyMatch(c -> c.getCfgValue() != null && c.getCfgValue().signum() > 0);
            if (!ok) throw new BizException(ResultCode.BAD_REQUEST, existingId == null
                ? "按面积/按层规则必须填正的初始分母(面积Σ㎡/层数)或指定基数键"
                : "按面积/按层规则须有分母(去计费参数页设该池的分母)或指定基数键");
        }
        if ("direct".equals(req.method()) && (req.members() == null || req.members().size() != 1))
            throw new BizException(ResultCode.BAD_REQUEST, "整笔归户规则受益人必须恰好一户");
    }

    private static String memberMonth(AllocRuleReq req) {
        return req.memberMonth() == null ? "" : req.memberMonth().trim();
    }

    private void apply(AllocRule r, AllocRuleReq req) {
        r.setZone(req.zone()); r.setBuildingId(req.buildingId());
        r.setFloorLabel(blank(req.floorLabel()) ? null : req.floorLabel().trim());
        r.setSide(blank(req.side()) ? null : req.side().trim());
        r.setFeeName(blank(req.feeName()) ? null : req.feeName().trim());
        // 池名由定位自动生成并覆盖入参(V69 契约);定位一格未填的存量池(V70 位置化改名前)保留原名不冲掉
        Building b = req.buildingId() == null ? null : buildings.selectById(req.buildingId());
        String auto = poolName(req.zone(), b == null ? null : b.getName(), req.floorLabel(), req.side(), req.feeName());
        boolean noLocation = blank(req.floorLabel()) && blank(req.side()) && blank(req.feeName());
        r.setName(noLocation && !blank(r.getName()) ? r.getName()
            : noLocation && !blank(req.name()) ? req.name().trim() : auto);
        r.setMethod(req.method()); r.setFeeKey(req.feeKey());   // S21:coefficient/extraQty 两列退出引擎,不再写(恒 NULL/0)
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note().trim());
        r.setRoundScale(req.roundScale() == null ? 2 : req.roundScale());
        r.setStdKind(req.stdKind() == null || req.stdKind().isBlank() ? null : req.stdKind());
        r.setBaseKey(req.baseKey() == null || req.baseKey().isBlank() ? null : req.baseKey().trim());
    }

    private void saveChildren(Integer ruleId, AllocRuleReq req) {
        // 绑定表:meters(携sign)优先,回退旧式 meterIds(sign 全=1)
        List<AllocPoolDTOs.MeterBind> binds = req.meters() != null && !req.meters().isEmpty() ? req.meters()
            : (req.meterIds() == null ? List.<Integer>of() : req.meterIds()).stream()
                .map(mid -> new AllocPoolDTOs.MeterBind(mid, null, 1)).toList();
        Set<Integer> seenM = new HashSet<>();
        for (AllocPoolDTOs.MeterBind b : binds) {
            if (b.meterId() == null || !seenM.add(b.meterId())) continue;
            AllocRuleMeter rm = new AllocRuleMeter();
            rm.setRuleId(ruleId); rm.setMeterId(b.meterId());
            rm.setSign(b.sign() == null ? 1 : b.sign());
            ruleMeters.insert(rm);
        }
        // 入向折入链整体覆盖(src=links[i].ruleId → dst=本规则;环在 generate 拓扑序时 409)
        ruleLinks.deleteByDst(ruleId);
        Set<String> seenL = new HashSet<>();
        for (AllocPoolDTOs.Link l : req.links() == null ? List.<AllocPoolDTOs.Link>of() : req.links()) {
            if (l.ruleId() == null || l.ruleId().equals(ruleId)
                    || !("fold_price".equals(l.type()) || "fold_qty".equals(l.type()))
                    || !seenL.add(l.ruleId() + "|" + l.type())) continue;
            AllocRuleLink lk = new AllocRuleLink();
            lk.setSrcRuleId(l.ruleId()); lk.setDstRuleId(ruleId); lk.setLinkType(l.type());
            ruleLinks.insert(lk);
        }
        // loss 规则无 member(受益人=当月有用电量的全部租户,生成时动态取)
        if ("loss".equals(req.method())) return;
        Set<Integer> seen = new HashSet<>();
        for (AllocMemberDTO m : req.members() == null ? List.<AllocMemberDTO>of() : req.members()) {
            if (m.tenantId() == null || !seen.add(m.tenantId())) continue;
            AllocRuleMember mb = new AllocRuleMember();
            mb.setRuleId(ruleId); mb.setTenantId(m.tenantId()); mb.setWeight(m.weight());
            mb.setAcctMonth(memberMonth(req));
            ruleMembers.insert(mb);
        }
    }

    private AllocRuleDTO ruleById(Integer id) {
        Map<Integer, String> nameById = new HashMap<>();
        for (AllocRule r : rules.selectByZone(null)) nameById.put(r.getId(), r.getName());
        return toDTO(rules.selectById(id), ruleMeters.selectByRule(id), ruleMembers.selectByRule(id),
            ruleLinks.selectList(new QueryWrapper<AllocRuleLink>().eq("dst_rule_id", id)), nameById, cfgEffective(null));
    }

    private static AllocRuleDTO toDTO(AllocRule r, List<AllocRuleMeter> binds, List<AllocRuleMember> mems,
                                      List<AllocRuleLink> inLinks, Map<Integer, String> ruleNameById,
                                      Map<String, BigDecimal> cfg) {
        return new AllocRuleDTO(r.getId(), r.getZone(), r.getName(), r.getBuildingId(), r.getMethod(),
            cfg.get("rule:" + r.getId() + "|coefficient"), nz(cfg.get("rule:" + r.getId() + "|extra_qty")),
            r.getFeeKey(), r.getNote(), r.getSortNo(),
            binds.stream().map(AllocRuleMeter::getMeterId).toList(),
            mems.stream().map(m -> new AllocMemberDTO(m.getTenantId(), m.getWeight(), m.getAcctMonth())).toList(),
            r.getRoundScale(), r.getStdKind(), r.getBaseKey(),
            binds.stream().map(b -> new AllocPoolDTOs.MeterBind(b.getMeterId(), null,
                b.getSign() == null ? 1 : b.getSign())).toList(),
            inLinks.stream().map(l -> new AllocPoolDTOs.Link(l.getSrcRuleId(),
                ruleNameById.get(l.getSrcRuleId()), l.getLinkType())).toList(),
            r.getFloorLabel(), r.getSide(), r.getFeeName());
    }

    // ── 参数(读=默认行∪当月行原值,解析「月行优先」由读侧完成;写=单行 upsert,value=null 删行回退默认) ──
    //    S21 过渡:cfgList 仍是 ''∪当月 的兼容读(前端 allocLogic.resolveCfg 只读用,参数页落地后收敛);
    //    引擎取值(loadCtx)已改走 VersionResolver(from 前滚/month 仅当月),两者只在 from 月行的后续月份上有差。
    public List<AllocCfgDTO> cfgList(String ym) {
        requireYm(ym);
        return cfgs.selectEffective(ym).stream()
            .map(c -> new AllocCfgDTO(c.getId(), c.getScope(), c.getCfgKey(), c.getCfgValue(), c.getAcctMonth(), c.getMode(), c.getNote()))
            .toList();
    }

    // mode 缺省(spec §6 兼容行):acctMonth 非空⇒month(=旧「仅当月」语义),空⇒from(初始版)
    public void saveCfg(AllocCfgReq req) {
        String scope = req.scope().trim(), key = req.cfgKey().trim();
        String month = req.acctMonth() == null ? "" : req.acctMonth().trim();
        String mode = req.mode() == null || req.mode().isBlank() ? (month.isEmpty() ? "from" : "month") : req.mode().trim();
        AllocCfg row = cfgs.selectByKey(scope, key, month, mode);
        if (req.value() == null) {
            if (row != null) cfgs.deleteById(row.getId());
            return;
        }
        if (row == null) {
            row = new AllocCfg();
            row.setScope(scope); row.setCfgKey(key); row.setAcctMonth(month); row.setMode(mode);
        }
        row.setCfgValue(req.value());
        row.setNote(req.note() == null || req.note().isBlank() ? null : req.note().trim());
        if (row.getId() == null) cfgs.insert(row); else cfgs.updateById(row);
    }

    // ── 生成(§1 alloc_result):按 ym 先删后插 gen 行幂等;manual 行保留不覆盖;缺抄跳过并入 warnings ──
    @Transactional
    public AllocGenerateResultDTO generate(String ym) {
        requireYm(ym);
        Ctx ctx = loadCtx(ym);
        // ── 池级+损耗快照(POOL-ENGINE-SPEC §3.5/§3.6):门禁→拓扑计算→按 ym 先删后插幂等 ──
        priceGate(ym, ctx);
        Map<Integer, PoolCalc> pools = computePools(ctx);
        // 户级贡献先算:已分摊/盈亏两列=Σ户级分摊额 / 已分摊−应分摊(V69 首次能落库)
        List<Contribution> all = computeAll(ctx, pools);
        Map<Integer, BigDecimal> allocByRule = new HashMap<>();
        for (Contribution c : all) if (c.ruleId() != null) allocByRule.merge(c.ruleId(), c.amount(), BigDecimal::add);
        LocalDateTime poolNow = LocalDateTime.now();
        poolResults.deleteByYm(ym);
        poolMeterResults.deleteByYm(ym);          // V73 逐表明细与池行同批先删后插
        // 四张结果表都先攒行后批量落库(P3-4 纯 I/O):行内容与表内行序一格未动,只是把「一行一发 insert」
        // 换成「500 行一发」。两表由交替写改成先池行后明细行是安全的 —— 逐表明细认 ym+rule_id+meter_id,
        // 不引用 alloc_pool_result.id(FK 只指向 alloc_rule),故池行不必先落库拿自增 id。
        List<AllocPoolResult> poolRows = new ArrayList<>();
        List<AllocPoolMeterResult> meterRows = new ArrayList<>();
        for (Map.Entry<Integer, PoolCalc> e : pools.entrySet()) {
            PoolCalc p = e.getValue();
            AllocPoolResult row = new AllocPoolResult();
            row.setYm(ym); row.setRuleId(e.getKey());
            row.setQtyTotal(p.qtyTotal() == null ? null : r2(p.qtyTotal()));
            row.setQtySharp(p.sharp() == null ? null : r2(p.sharp()));
            row.setQtyPeak(p.peak() == null ? null : r2(p.peak()));
            row.setQtyFlat(p.flat() == null ? null : r2(p.flat()));
            row.setQtyValley(p.valley() == null ? null : r2(p.valley()));
            row.setExtraQtySnap(p.extra() == null ? null : r2(p.extra()));
            row.setCostAmount(p.cost());
            row.setBaseSnap(p.base() == null ? null : r2(p.base()));
            row.setStdValue(p.std());
            row.setFoldAdd(p.foldAdd());
            row.setPriceSnap(p.price());
            BigDecimal alloc = r2(nz(allocByRule.get(e.getKey())));
            row.setAllocatedAmount(p.cost() == null && alloc.signum() == 0 ? null : alloc);
            row.setGapAmount(p.cost() == null ? null : alloc.subtract(p.cost()));   // 盈亏=已分摊−应分摊
            row.setWarn(p.warn());
            row.setGeneratedAt(poolNow);
            poolRows.add(row);
            AllocRule rr = ruleOf(ctx, e.getKey());
            if (rr != null) meterRows.addAll(poolMeterLines(rr, ctx, p, poolNow));
        }
        insertBatched(poolRows, poolResults::insertBatch);
        insertBatched(meterRows, poolMeterResults::insertBatch);
        lossResults.deleteByYm(ym);
        insertBatched(computeLossUnits(ctx), lossResults::insertBatch);

        // ── 既有户级流程(alloc_result=P-C 缴费单契约,manual 保留语义不动) ──
        // (tenant|fee) 聚合(uk 粒度);多规则同费项合并 → rule_id 置空,note 并列规则名
        Map<String, List<Contribution>> byKey = new LinkedHashMap<>();
        for (Contribution c : all) byKey.computeIfAbsent(c.tenantId() + "|" + c.feeKey(), k -> new ArrayList<>()).add(c);

        results.deleteGenByYm(ym);
        Set<String> manualKeys = new HashSet<>();
        for (AllocResult m : results.selectByYm(ym)) manualKeys.add(m.getTenantId() + "|" + m.getFeeKey());

        int manualKept = manualKeys.size();   // 删 gen 后仅剩 manual 行=全部保留
        List<AllocResult> genRows = new ArrayList<>();
        Set<Integer> tenantIds = new HashSet<>();
        LocalDateTime now = LocalDateTime.now();
        for (Map.Entry<String, List<Contribution>> e : byKey.entrySet()) {
            List<Contribution> cs = e.getValue();
            if (manualKeys.contains(e.getKey())) continue;   // manual 行保留不覆盖
            Contribution first = cs.get(0);
            AllocResult r = new AllocResult();
            r.setTenantId(first.tenantId());
            r.setYm(ym);
            r.setFeeKey(first.feeKey());
            r.setRuleId(cs.size() == 1 ? first.ruleId() : null);
            r.setQty(cs.stream().map(Contribution::qty).filter(Objects::nonNull).reduce(BigDecimal::add).orElse(null));
            r.setAmount(r2(cs.stream().map(Contribution::amount).reduce(BigDecimal.ZERO, BigDecimal::add)));
            r.setRateSnap(cs.size() == 1 ? first.rate() : null);
            r.setPriceSnap(cs.size() == 1 ? first.price() : null);
            r.setSource("gen");
            String note = cs.stream().map(Contribution::note).filter(Objects::nonNull).distinct()
                .reduce((a, b) -> a + ";" + b).orElse(null);
            r.setNote(note);
            r.setGeneratedAt(now);
            genRows.add(r);
            tenantIds.add(first.tenantId());
        }
        insertBatched(genRows, results::insertBatch);
        // 损耗链会二次派生规则用量,同一「缺抄」可能重复上报 → 去重保序
        return new AllocGenerateResultDTO(genRows.size(), tenantIds.size(), manualKept,
            new ArrayList<>(new LinkedHashSet<>(ctx.warnings())));
    }

    // 结果表批量落库:每 500 行一条 INSERT。行序=入参顺序,自增 id 仍按原顺序分配(MySQL 多值 INSERT 顺序发号),
    // 故 selectByYm 无 ORDER BY 的两张池表读出来的行序不变。空表直接跳过——<foreach> 拼不出合法 VALUES。
    private static <T> void insertBatched(List<T> rows, java.util.function.Consumer<List<T>> insertBatch) {
        for (int i = 0; i < rows.size(); i += 500)
            insertBatch.accept(rows.subList(i, Math.min(i + 500, rows.size())));
    }

    // ── 结果读取 ──
    public List<AllocResultDTO> resultByYm(String ym) {
        requireYm(ym);
        Map<Integer, Tenant> tById = new HashMap<>();
        for (Tenant t : tenants.selectList(null)) tById.put(t.getId(), t);
        Map<Integer, Building> bById = new HashMap<>();
        for (Building b : buildings.selectList(null)) bById.put(b.getId(), b);
        // 租户→楼栋:该租户户内表的楼栋(众数;分摊上下文里够准,主数据不新增字段)
        Map<Integer, Integer> tb = new HashMap<>();
        for (Meter m : meters.selectList(null))
            if (m.getTenantId() != null && m.getBuildingId() != null) tb.putIfAbsent(m.getTenantId(), m.getBuildingId());
        return results.selectByYm(ym).stream().map(r -> {
            Tenant t = tById.get(r.getTenantId());
            Integer bid = tb.get(r.getTenantId());
            Building b = bid == null ? null : bById.get(bid);
            return new AllocResultDTO(r.getId(), r.getTenantId(), t == null ? null : t.getCompanyName(),
                bid, b == null ? null : b.getName(), r.getYm(), r.getFeeKey(), r.getRuleId(),
                r.getQty(), r.getAmount(), r.getRateSnap(), r.getPriceSnap(),
                r.getSource(), r.getNote(), r.getGeneratedAt());
        }).toList();
    }

    // 抽屉逐费项明细:表级明细不落库,现算(同用量派生口径);与快照不符 → stale=true「读数已变,可重新生成」
    public List<AllocDetailRowDTO> resultDetail(Integer tenantId, String ym) {
        requireYm(ym);
        Ctx ctx = loadCtx(ym);
        Map<String, BigDecimal> liveByFee = new HashMap<>();
        Map<String, Contribution> liveRow = new HashMap<>();
        for (Contribution c : computeAll(ctx)) {
            if (!c.tenantId().equals(tenantId)) continue;
            liveByFee.merge(c.feeKey(), c.amount(), BigDecimal::add);
            liveRow.putIfAbsent(c.feeKey(), c);
        }
        Map<Integer, AllocRule> ruleById = new HashMap<>();
        for (AllocRule r : rules.selectList(null)) ruleById.put(r.getId(), r);
        List<AllocDetailRowDTO> out = new ArrayList<>();
        for (AllocResult r : results.selectByYm(ym)) {
            if (!r.getTenantId().equals(tenantId)) continue;
            BigDecimal live = "manual".equals(r.getSource()) ? null : liveByFee.get(r.getFeeKey());
            boolean stale = live != null && live.subtract(r.getAmount()).abs().compareTo(new BigDecimal("0.005")) > 0;
            AllocRule rule = r.getRuleId() == null ? null : ruleById.get(r.getRuleId());
            String ruleName = rule != null ? rule.getName()
                : liveRow.containsKey(r.getFeeKey()) && r.getRuleId() == null && !"manual".equals(r.getSource())
                    ? liveRow.get(r.getFeeKey()).ruleName() : null;
            out.add(new AllocDetailRowDTO(r.getFeeKey(), r.getRuleId(), ruleName,
                r.getQty(), r.getAmount(), r.getRateSnap(), r.getPriceSnap(), r.getSource(), r.getNote(),
                live == null ? null : r2(live), stale));
        }
        return out;
    }

    // ── 手工行(孵化协议固定收取等):同键 upsert 置 manual;仅 manual 行可删 ──
    public AllocResultDTO saveManual(AllocManualReq req) {
        AllocResult row = results.selectOne(new QueryWrapper<AllocResult>()
            .eq("tenant_id", req.tenantId()).eq("ym", req.ym()).eq("fee_key", req.feeKey()));
        if (row == null) {
            row = new AllocResult();
            row.setTenantId(req.tenantId()); row.setYm(req.ym()); row.setFeeKey(req.feeKey());
        }
        row.setRuleId(null);
        row.setQty(req.qty());
        row.setAmount(r2(req.amount()));
        row.setRateSnap(null); row.setPriceSnap(null);
        row.setSource("manual");
        row.setNote(req.note() == null || req.note().isBlank() ? null : req.note().trim());
        row.setGeneratedAt(LocalDateTime.now());
        if (row.getId() == null) results.insert(row); else results.updateById(row);
        return resultByYm(req.ym()).stream().filter(d -> d.tenantId().equals(req.tenantId())
            && d.feeKey().equals(req.feeKey())).findFirst().orElseThrow();
    }

    public void deleteResult(Integer id) {
        AllocResult r = results.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if (!"manual".equals(r.getSource()))
            throw new BizException(ResultCode.CONFLICT, "仅手工行可单独删除;生成行请整月重新生成");
        results.deleteById(id);
    }

    // ── 损耗与对账(§2.4/§2.5 读时派生,不落表;负值黄警示不阻断——CP/PV/parkEnergy 同范式) ──
    public AllocReconDTO recon(String ym) {
        requireYm(ym);
        Ctx ctx = loadCtx(ym);
        List<AllocLossRowDTO> lossRows = lossTable(ctx);

        // 规则行:成本=规则用量×单价全额(AD 口径);已分摊=户级现算Σ(读时派生;快照差看月度段 stale 标)
        Map<Integer, BigDecimal> allocatedByRule = new HashMap<>();
        BigDecimal lossAllocated = BigDecimal.ZERO;
        for (Contribution c : computeAll(ctx)) {
            if (c.ruleId() != null) allocatedByRule.merge(c.ruleId(), c.amount(), BigDecimal::add);
            else lossAllocated = lossAllocated.add(c.amount());
        }
        List<AllocReconRowDTO> rows = new ArrayList<>();
        for (AllocRule rule : rules.selectByZone(null)) {
            if ("loss".equals(rule.getMethod()) || "share_water".equals(rule.getFeeKey())) continue;
            RuleUsage u = ruleUsage(rule, ctx);
            if (u == null) continue;
            BigDecimal cost = ruleCostAmount(rule, u, ctx);
            if (cost == null) continue;
            BigDecimal price = u.qty().signum() == 0 ? null
                : cost.divide(u.qty(), 6, RoundingMode.HALF_UP);
            BigDecimal allocated = r2(nz(allocatedByRule.get(rule.getId())));
            rows.add(new AllocReconRowDTO(rule.getId(), rule.getName(), rule.getZone(), rule.getFeeKey(),
                u.qty(), price, cost, allocated, allocated.subtract(cost)));
        }
        // 损耗组行:成本量=残差E(负),成本额=|E|×price_loss;已分摊=share_elec_loss 户级Σ
        for (String zone : List.of("p1", "p2")) {
            BigDecimal lossQty = lossRows.stream().filter(l -> zone.equals(l.zone()))
                .map(AllocLossRowDTO::lossQty).filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (lossQty.signum() == 0) continue;
            BigDecimal priceLoss = lossPrice(zone, ctx);
            BigDecimal cost = priceLoss == null ? null : r2(lossQty.abs().multiply(priceLoss));
            BigDecimal allocated = r2(zoneLossAllocated(zone, ctx));
            rows.add(new AllocReconRowDTO(null, ("p1".equals(zone) ? "一期" : "二期") + "损耗", zone, FEE_LOSS,
                lossQty, priceLoss, cost, allocated, cost == null ? null : allocated.subtract(cost)));
        }
        // 互认提示:本月分摊合计 vs 电费成本模型 allocated 费项Σ(单向读,不强拦)
        BigDecimal allocSum = r2(results.sumAmountByYm(ym));
        BigDecimal ecAllocated = elecEntries.selectByMonth(ym).stream()
            .filter(e -> "allocated".equals(e.getFeeKey()))
            .map(e -> nz(e.getAmount())).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new AllocReconDTO(lossRows, rows, allocSum, r2(ecAllocated));
    }

    // ══════════ 计算引擎内核 ══════════
    private record Ctx(String ym, Map<Integer, Meter> meterById, Map<Integer, MeterReading> readingByMeter,
                       Map<String, BigDecimal> cfg, Map<Integer, BigDecimal> areaByTenant,
                       // S5 补刀:楼栋级池(rule.building_id 非空)面积只吃该栋合同(rule40 电梯 158.88 锚点)
                       Map<Integer, Map<Integer, BigDecimal>> areaByBuildingTenant,
                       List<AllocRule> ruleList, Map<Integer, List<AllocRuleMeter>> bindsByRule,
                       Map<Integer, List<AllocRuleMember>> membersByRule, List<AllocRuleLink> linkList,
                       Map<Integer, Building> buildingById,
                       Map<String, List<Integer>> inForceByZone,
                       Map<String, Map<Integer, BigDecimal>> areaByZoneTenant,
                       // 刀D §D.1 楼层两级回退的两个来源(当月覆盖合同带出的单元 / 未停用的户内表)
                       Map<Integer, List<Unit>> unitsByTenant, Map<Integer, List<Meter>> metersByTenant,
                       Map<Integer, String> nameByTenant,   // §E4 两源冲突 warn 要点名到户
                       // 三态挂零判别:有绑定记录的规则 id(未按在册过滤)——bindsByRule 已剔除不在服务中的表,
                       // 光看它分不清「从未绑表」和「绑了但本月全停」,后者要挂零陈列不报缺读数
                       Set<Integer> boundRules,
                       // 刀2:楼栋 → 楼层 → 租户 → 租金行绑定面积Σ(rentAreaByBuildingFloor 产物,层定位 area 池用)
                       Map<Integer, Map<Integer, Map<Integer, BigDecimal>>> rentAreaByBuildingFloorTenant,
                       List<String> warnings) {}

    // (包级可见:S4 出账引擎经 poolContributions 消费公摊行)
    // base=户份额基数(area 池=该户面积㎡,其余 null;S4-3 D① 收取价=收取单价×base 要精确面积,别用 amount/rate 反推);
    // lossBuildings/lossChainName=损耗链成员楼栋与链名(仅 ruleId=null 损耗行;S4-3 E2 金额口径分链计要圈链内行)。
    record Contribution(Integer tenantId, String feeKey, Integer ruleId, String ruleName,
                        BigDecimal qty, BigDecimal amount, BigDecimal rate, BigDecimal price, String note,
                        BigDecimal base, List<Integer> lossBuildings, String lossChainName) {
        Contribution(Integer tenantId, String feeKey, Integer ruleId, String ruleName,
                     BigDecimal qty, BigDecimal amount, BigDecimal rate, BigDecimal price, String note) {
            this(tenantId, feeKey, ruleId, ruleName, qty, amount, rate, price, note, null, null, null);
        }
    }

    // 规则用量(总+分时四段;缺抄表跳过并入 warnings)
    private record RuleUsage(BigDecimal qty, BigDecimal sharp, BigDecimal peak, BigDecimal flat, BigDecimal valley) {}

    private Ctx loadCtx(String ym) {
        Map<Integer, Meter> meterById = new HashMap<>();
        // V68:当月已停用表整体不进计算体——池绑定遍历(ruleUsage/poolSegQty/isNetPool/逐表行ROUND)
        // 与损耗组 C/D 统计都只看 ctx.meterById/bindsByRule,故在此一处过滤即全覆盖。
        Map<Integer, String> zoneOfBuilding = new HashMap<>();   // 楼栋期别=该栋表的 zone(园区级池 fallback 用)
        for (Meter m : meters.selectList(null)) {
            if (m.getBuildingId() != null && m.getZone() != null) zoneOfBuilding.putIfAbsent(m.getBuildingId(), m.getZone());
            if (!MeterService.outOfService(m, ym)) meterById.put(m.getId(), m);
        }
        Map<Integer, MeterReading> readingByMeter = new HashMap<>();
        for (MeterReading r : readings.selectByYm(ym)) readingByMeter.put(r.getMeterId(), r);
        // 参数解析(S21 §2.2):整表载入,站在 ym 按行 mode 取值 —— month 仅当月优先,from 取 acct_month<=ym 最大者前滚
        // (''=初始版最小)。与 tenant_price_cfg 同一份 VersionResolver;cfgVal 仍是 scope|key 扁平查表。
        Map<String, BigDecimal> cfg = VersionResolver.effectiveMap(cfgs.selectList(null).stream()
            .map(c -> new VersionResolver.Row(c.getScope(), c.getCfgKey(), c.getAcctMonth(), c.getMode(), c.getCfgValue(), c.getId()))
            .toList(), ym);
        // 户租赁面积=Σ当月覆盖合同分摊面积(S5 §1:Σ租金计费行 area+IFNULL(area_shared,0),无租金行回退 rent_area)
        // S15 §4 面积污染根修:宿舍计费行(dormTerm)面积单独聚合,不混进主楼栋口径
        Map<Integer, BigDecimal> rentLineArea = new HashMap<>();
        Map<Integer, BigDecimal> dormLineArea = new HashMap<>();
        Map<Integer, ContractBillingTerm> rentTermById = new HashMap<>();   // 刀2:楼层面积口径按行绑定取
        for (ContractBillingTerm t : billingTerms.selectList(null))
            if (ContractService.BUILDING_RENT_KEYS.contains(t.getFeeKey())) {
                (dormTerm(t) ? dormLineArea : rentLineArea)
                    .merge(t.getContractId(), nz(t.getArea()).add(nz(t.getAreaShared())), BigDecimal::add);
                rentTermById.put(t.getId(), t);   // 楼层口径(billing_term_unit)不拆:dorm 行绑的单元本就在宿舍楼
            }
        Set<Integer> areaFallback = new HashSet<>();   // 回退 rent_area 的合同(收成一条 warn)
        Roster ro = loadRoster(ym);
        Map<Integer, BigDecimal> areaByTenant = new HashMap<>();
        Map<Integer, Map<Integer, BigDecimal>> areaByBuildingTenant = new HashMap<>();
        // S8:合同集=名册同一份 covering(当月有效),不用 status='active' —— 与 areaByZoneTenant 同口径。
        // active 是"今天"的状态:续签两段会同时 active 把面积翻倍(宏玥 257.30→514.60、旭化成 6 段叠成 4511.60),
        // 且历史月的有效段常标 renewed 反而被漏掉。缺起止日期的合同判不出在租 → 不计面积(与自动名册一致,dateless warn 已报)。
        for (Contract c : ro.covering()) {
            if (c.getTenantId() == null) continue;
            BigDecimal a = allocArea(c, rentLineArea, dormLineArea, areaFallback);   // 非宿舍面积
            if (a != null) {
                areaByTenant.merge(c.getTenantId(), a, BigDecimal::add);
                if (c.getBuildingId() != null)
                    areaByBuildingTenant.computeIfAbsent(c.getBuildingId(), k -> new HashMap<>())
                        .merge(c.getTenantId(), a, BigDecimal::add);
            }
            // S15 §4 宿舍行面积:户总面积照算(园区级显式池口径不变);楼栋图只在主楼栋本就是宿舍楼
            // (zone=dorm,纯宿舍/汤周杰型)时归主楼栋——混装合同的宿舍行定不出宿舍楼栋,引擎不猜 location,
            // 数据错的主楼栋由 SQL 刀修正
            BigDecimal d = dormLineArea.get(c.getId());
            if (d != null) {
                areaByTenant.merge(c.getTenantId(), d, BigDecimal::add);
                if (c.getBuildingId() != null && "dorm".equals(zoneOfBuilding.get(c.getBuildingId())))
                    areaByBuildingTenant.computeIfAbsent(c.getBuildingId(), k -> new HashMap<>())
                        .merge(c.getTenantId(), d, BigDecimal::add);
            }
        }
        List<AllocRuleMeter> rawBinds = ruleMeters.selectList(null);
        Set<Integer> boundRules = rawBinds.stream().map(AllocRuleMeter::getRuleId).collect(Collectors.toSet());
        Map<Integer, List<AllocRuleMeter>> bindsByRule = rawBinds.stream()
            .filter(b -> meterById.containsKey(b.getMeterId()))   // 停用表的绑定当月不生效(V68)
            .collect(groupingBy(AllocRuleMeter::getRuleId));
        // 受益人:版本组前滚(S14,acct_month≤ym 最大版本组),解析后进 ctx——引擎与读侧看到的是同一份当月受益人
        Map<Integer, List<AllocRuleMember>> membersByRule = new HashMap<>();
        ruleMembers.selectList(null).stream().collect(groupingBy(AllocRuleMember::getRuleId))
            .forEach((rid, rows) -> membersByRule.put(rid, pickMembers(rows, ym)));
        Map<Integer, Building> buildingById = new HashMap<>();
        for (Building b : buildings.selectList(null)) buildingById.put(b.getId(), b);
        Map<String, Map<Integer, BigDecimal>> areaByZone =
            areaByZoneTenant(ro.covering(), ro.unitsByContract(), zoneOfBuilding, rentLineArea, dormLineArea, areaFallback);
        // 刀2:层定位 area 池的楼层面积口径(covering 合同的租金行 × billing_term_unit 绑定 × unit 楼层)
        Map<Integer, Integer> tenantOfCovering = new HashMap<>();
        for (Contract c : ro.covering())
            if (c.getTenantId() != null) tenantOfCovering.put(c.getId(), c.getTenantId());
        // 单元全表索引复用 loadRoster 那一份(同一句 units.selectList(null) 建的同一个 id→Unit 映射),不再查第二遍
        Map<Integer, Map<Integer, Map<Integer, BigDecimal>>> rentAreaByBldFloor =
            rentAreaByBuildingFloor(termUnits.selectList(null), rentTermById, tenantOfCovering, ro.unitById());
        // 缺日期户维持不入自动名册(塞进去会凭空多摊钱),但必须点名报数,别让缺口无声消失。
        // ⭐点名铁律(2026-08-14 用户拍板「不希望出现无法手动修改的问题」):告警只报数字=让用户去
        // 431 份合同里大海捞针,等于没有修复路径。聚合告警一律带「前 N 个名字 + 去哪筛全量」。
        List<String> warnings = new ArrayList<>();
        if (!areaFallback.isEmpty()) {
            Map<Integer, String> nameOfContract = new HashMap<>();
            for (Contract c : ro.covering())
                if (areaFallback.contains(c.getId())) nameOfContract.put(c.getId(), ro.nameOf(c.getTenantId()));
            // ⚠ 括号里的筛选名必须与合同页 chip 文案逐字相同,否则用户按图索骥找不到那个按钮
            warnings.add("有 " + areaFallback.size() + " 份合同无租金计费行,分摊面积回退合同租赁面积,请补计费行"
                + suffix(nameOfContract.values()) + "(合同页「无租金计费行」筛选可列全)");
        }
        List<String> datelessNames = ro.stateByTenant().entrySet().stream()
            .filter(e -> "unknown".equals(e.getValue())).map(e -> ro.nameOf(e.getKey())).toList();
        if (!datelessNames.isEmpty())
            warnings.add("有 " + datelessNames.size() + " 户因合同缺起止日期无法判定是否在租,未进入自动在租名册参与分摊,"
                + "请补齐合同起止日期" + suffix(datelessNames) + "(合同页「缺起止日期」筛选可列全)");
        // V75 §E3.3:存疑(疑似重复建档)表本月有读数却不计入 —— 点名报数,别让隔离静默发生
        long suspects = meterById.values().stream()
            .filter(m -> "shadow".equals(m.getSuspect()) && readingByMeter.containsKey(m.getId())).count();
        // §F3:三处出口现在真的都挡住了(分表Σ=inSubSigma / 总表C=lossGroups infra 分支 / 池分母=poolSegQty),文案与实现一致
        if (suspects > 0) warnings.add("本月有 " + suspects + " 块存疑表(疑似重复建档)带读数但未计入楼栋分表Σ、楼栋总表C 与公摊池分母,"
            + "请在抄表屏「只看存疑」逐条认对后合并或补齐档案");
        return new Ctx(ym, meterById, readingByMeter, cfg, areaByTenant, areaByBuildingTenant,
            rules.selectByZone(null), bindsByRule, membersByRule, ruleLinks.selectList(null),
            buildingById, inForceByZone(ro.covering(), ro.unitsByContract(), zoneOfBuilding),
            areaByZone,
            ro.unitsByTenant(), tenantMeters(meterById.values()), ro.nameById(), boundRules,
            rentAreaByBldFloor, warnings);
    }

    private static BigDecimal cfgVal(Ctx ctx, String scope, String key) { return ctx.cfg().get(scope + "|" + key); }

    private RuleUsage ruleUsage(AllocRule rule, Ctx ctx) {
        BigDecimal qty = BigDecimal.ZERO, sharp = BigDecimal.ZERO, peak = BigDecimal.ZERO,
            flat = BigDecimal.ZERO, valley = BigDecimal.ZERO;
        boolean any = false;
        for (AllocRuleMeter b : ctx.bindsByRule().getOrDefault(rule.getId(), List.of())) {
            Integer mid = b.getMeterId();
            Meter m = ctx.meterById().get(mid);
            MeterReading r = ctx.readingByMeter().get(mid);
            BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
            if (u == null) {   // 缺读数=跳过并标缺抄,不硬算(§2.1)
                ctx.warnings().add("规则「" + rule.getName() + "」绑定表『" + (m == null ? "#" + mid : m.getName()) + "』" + ctx.ym() + " 缺抄");
                continue;
            }
            any = true;
            int sg = b.getSign() == null ? 1 : b.getSign();
            BigDecimal s = BigDecimal.valueOf(sg);
            qty = qty.add(u.multiply(s));
            BigDecimal uS = MeterService.usage(r.getPrevSharp(), r.getCurrSharp(), r.getFactorSnap());
            BigDecimal uP = MeterService.usage(r.getPrevPeak(), r.getCurrPeak(), r.getFactorSnap());
            BigDecimal uF = MeterService.usage(r.getPrevFlat(), r.getCurrFlat(), r.getFactorSnap());
            BigDecimal uV = MeterService.usage(r.getPrevValley(), r.getCurrValley(), r.getFactorSnap());
            // sign=-1 剔除表只有总读数无分时 → 总量落平段冲减(复刻 Excel 五车间电梯 L87=平1013.2-670.06)
            if (sg < 0 && uS == null && uP == null && uF == null && uV == null) uF = u;
            sharp = sharp.add(nz(uS).multiply(s));
            peak = peak.add(nz(uP).multiply(s));
            flat = flat.add(nz(uF).multiply(s));
            valley = valley.add(nz(uV).multiply(s));
        }
        return any ? new RuleUsage(qty, sharp, peak, flat, valley) : null;
    }

    // 规则全额成本(§2.3 AD 口径):p1=ROUND((用量+加度)×单价,2);p2=分时金额 W(无分时段回退 平价×总量)
    private BigDecimal ruleCostAmount(AllocRule rule, RuleUsage u, Ctx ctx) {
        if ("p1".equals(rule.getZone())) {
            BigDecimal price = cfgVal(ctx, "p1", "price_flat");
            if (price == null) { ctx.warnings().add("缺参数 p1.price_flat,规则「" + rule.getName() + "」跳过"); return null; }
            return r2(u.qty().add(poolExtra(rule, ctx)).multiply(price));
        }
        boolean hasTou = u.sharp().signum() != 0 || u.peak().signum() != 0
            || u.flat().signum() != 0 || u.valley().signum() != 0;
        BigDecimal pNorm = cfgVal(ctx, "p2", "price_norm");
        if (hasTou) {
            return touAmount(u.sharp(), u.peak(), u.flat(), u.valley,
                cfgVal(ctx, "p2", "price_sharp"), cfgVal(ctx, "p2", "price_peak"),
                pNorm, cfgVal(ctx, "p2", "price_valley"));
        }
        if (pNorm == null) { ctx.warnings().add("缺参数 p2.price_norm,规则「" + rule.getName() + "」跳过"); return null; }
        return r2(u.qty().add(poolExtra(rule, ctx)).multiply(pNorm));
    }

    // 全部规则(非 loss)+损耗链 → 户级贡献清单(生成/抽屉/对账共用同一计算体,口径全等由结构保证)
    private List<Contribution> computeAll(Ctx ctx) { return computeAll(ctx, computePools(ctx)); }

    // V69:户级分摊改由池核算结果(cost/std/base)驱动——已分摊必须与应分摊同源,否则盈亏两列无意义。
    // 池的 qty/cost/std/base 口径一字不改(仍是 computePool 的输出),这里只做「摊到受益人」。
    private List<Contribution> computeAll(Ctx ctx, Map<Integer, PoolCalc> pools) {
        List<Contribution> out = new ArrayList<>();
        for (AllocRule rule : ctx.ruleList()) {
            if ("loss".equals(rule.getMethod()) || "share_water".equals(rule.getFeeKey())) continue;   // loss 走损耗链;水占位不生成
            PoolCalc p = pools.get(rule.getId());
            if (p == null) continue;
            // S13 §4 V64 加价档:ref 池挂了显式层份成员=价目直供池(户=std×weight),放行;
            // 其余 ref(纯标准行/fold 源)与缺读数照旧不出户级。cost 保持 null=不入池合计,不双计货梯表。
            boolean refWeighted = "ref".equals(rule.getMethod()) && p.std() != null
                && ctx.membersByRule().getOrDefault(rule.getId(), List.of()).stream()
                    .anyMatch(m -> m.getWeight() != null);
            if (p.cost() == null && !refWeighted) continue;   // 缺读数/ref 纯标准行不出户级
            out.addAll(memberAmounts(rule, p, ctx));
        }
        out.addAll(lossContributions(ctx));
        return out;
    }

    // S4-0.2 出账引擎读池:池级金额取当月 alloc_pool_result 快照(与公摊屏已核对口径一致,不随读数后改漂移),
    // 户级份额解析走 memberAmounts 同一路径;含损耗链行(ruleId=null,损耗无池快照,现算)。
    // 无池快照=当月未核算 → 空表不抛错。
    public List<Contribution> poolContributions(String ym) {
        requireYm(ym);
        List<AllocPoolResult> snaps = poolResults.selectByYm(ym);
        if (snaps.isEmpty()) return List.of();
        Ctx ctx = loadCtx(ym);
        Map<Integer, PoolCalc> pools = new LinkedHashMap<>();
        for (AllocPoolResult s : snaps)
            pools.put(s.getRuleId(), new PoolCalc(s.getQtyTotal(), s.getQtySharp(), s.getQtyPeak(),
                s.getQtyFlat(), s.getQtyValley(), s.getExtraQtySnap(), s.getCostAmount(),
                s.getBaseSnap(), s.getStdValue(), s.getFoldAdd(), s.getPriceSnap(), s.getWarn()));
        return computeAll(ctx, pools);
    }

    // 四类方法金额化(§2.2)——户级;cost/std 取池快照口径(area 按户租赁面积/floor 按 weight/direct 整额/none 与 ref 不摊)
    List<Contribution> memberAmounts(AllocRule rule, PoolCalc p, Ctx ctx) {
        List<AllocRuleMember> explicit = ctx.membersByRule().getOrDefault(rule.getId(), List.of());
        // 园区级池无显式受益人 → 回退该 zone 全园在租名册(显式配了的以显式为准,fallback 只在空时生效)
        boolean auto = autoMembers(rule, explicit.isEmpty());
        List<AllocRuleMember> mems = auto
            ? ctx.inForceByZone().getOrDefault(rule.getZone(), List.of()).stream().map(AllocService::autoMember).toList()
            : explicit;
        // 自动名册按期别取面积(整户面积会把多场地户的厂房算进宿舍池);显式勾选:楼栋级池只吃该栋合同面积
        // (S5 补刀:rule40 A座电梯,可莱恩=A602 1986 而非全户Σ 6293),园区级显式池仍按户面积Σ
        Map<Integer, BigDecimal> areaOf = auto
            ? ctx.areaByZoneTenant().getOrDefault(rule.getZone(), Map.of())
            : rule.getBuildingId() != null
                ? ctx.areaByBuildingTenant().getOrDefault(rule.getBuildingId(), Map.of())
                : ctx.areaByTenant();
        List<Contribution> out = new ArrayList<>();
        BigDecimal cost = p.cost();   // ref 价目直供池为 null(S13 §4),下游用到处均须判空
        BigDecimal qty = nz(p.qtyTotal());
        BigDecimal effPrice = cost == null || qty.signum() == 0 ? null : cost.divide(qty, 6, RoundingMode.HALF_UP);
        if (auto && "floor".equals(rule.getMethod()))
            ctx.warnings().add("池「" + rule.getName() + "」园区级按层池无显式受益人,已按全园在租名册逐层分桶分摊,请核对");
        // 静默吞钱防线:能摊却没人可摊 → 报出未摊金额(area/floor 原先 for 空转,连 warning 都不出)
        if (mems.isEmpty() && ("area".equals(rule.getMethod()) || "floor".equals(rule.getMethod()))) {
            ctx.warnings().add("池「" + rule.getName() + "」无受益人,应分摊 " + r2(cost)
                + " 元未摊到户 —— 点该池名进配置抽屉,在第④段勾受益人");
            return out;
        }
        List<String> noArea = new ArrayList<>();   // 自动名册里当月无面积的户(点名,不只计数)
        switch (rule.getMethod()) {
            case "direct" -> {   // 户金额=全额整笔归户(AC14 型)
                if (mems.isEmpty()) {
                    ctx.warnings().add("规则「" + rule.getName() + "」无受益人,跳过 —— 户对户池只摊给一户,"
                        + "点该池名进配置抽屉,用第④段的「受益户」搜索框挑那一户");
                    break;
                }
                out.add(new Contribution(mems.get(0).getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                    qty, cost, null, effPrice, null));
            }
            case "area" -> {     // 标准=元/㎡(池 std);户金额=ROUND(标准×户租赁面积,2)(AC15/F8 型)
                BigDecimal std = p.std();
                if (std == null) break;
                BigDecimal base = p.base();
                // 刀2:层定位池(楼栋级且 floor_label 可解析出层号)→ 户面积按 billing_term_unit 楼层口径,
                // 同栋跨层户不再被整栋面积多收(陈相钊 2462.87→462.87);该户在该栋无任何租金行绑定 →
                // 回退整栋口径并收成一条 warn(渐进,不许未绑定户凭空变 0)。侧向(东/西)本刀不做,残差见报告。
                Integer poolFloor = auto || rule.getBuildingId() == null ? null : floorNum(rule.getFloorLabel());
                Map<Integer, Map<Integer, BigDecimal>> bldFloors = poolFloor == null ? null
                    : ctx.rentAreaByBuildingFloorTenant().getOrDefault(rule.getBuildingId(), Map.of());
                Map<Integer, BigDecimal> floorArea = bldFloors == null ? null
                    : bldFloors.getOrDefault(poolFloor, Map.of());
                List<String> fellBack = new ArrayList<>();
                for (AllocRuleMember m : mems) {
                    BigDecimal area;
                    if (floorArea != null && boundInBuilding(bldFloors, m.getTenantId())) {
                        area = floorArea.get(m.getTenantId());
                    } else {
                        area = areaOf.get(m.getTenantId());
                        if (floorArea != null && area != null && area.signum() != 0)
                            fellBack.add(ctx.nameByTenant().getOrDefault(m.getTenantId(), "#" + m.getTenantId()));
                    }
                    if (area == null || area.signum() == 0) {
                        // ⭐点名而非编号:同一循环上面 4 行的 fellBack 分支早就用了 nameByTenant,这里漏了 ——
                        // 用户拿到「受益租户#371」在界面上无从查起(租户屏搜不了内部 id),等于没有修复路径。
                        String who = ctx.nameByTenant().getOrDefault(m.getTenantId(), "#" + m.getTenantId());
                        if (auto) noArea.add(who);   // 自动名册逐户报会淹掉提醒条 → 收成一条并点名
                        else ctx.warnings().add("规则「" + rule.getName() + "」受益租户「" + who
                            + "」当月无有效合同或无租赁面积,跳过 —— 该池受益人是长期名单,算历史月请在池抽屉勾「只改本月」另存当月名册");
                        continue;
                    }
                    BigDecimal qtyShare = base == null || base.signum() == 0 ? null
                        : r2(qty.multiply(area).divide(base, 10, RoundingMode.HALF_UP));
                    out.add(new Contribution(m.getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                        qtyShare, r2(std.multiply(area)), std, effPrice, null, area, null, null));
                }
                if (!fellBack.isEmpty())
                    ctx.warnings().add("池「" + rule.getName() + "」按层取面积:" + String.join("、", fellBack)
                        + " 在该栋无计费行↔单元绑定,已回退整栋面积口径 —— 合同页「租金行未绑单元」筛选可列全,"
                        + "打开合同在标的段的「面积落在」处勾单元");
            }
            case "floor" -> {    // 元/层=池 std;显式份额户=元/层×weight;其余户按楼层分桶,每桶各分 1 份(§D.2)
                BigDecimal perFloor = p.std();
                if (perFloor == null) break;
                // S13 §7 二期车间池守卫(仅 p2;一期分桶是常态不警):全员显式层份时 Σweight 偏离系数 T>0.01
                // → warn(不封顶不阻断);出现 weight=null 成员 → warn(防楼层分桶与手工层份两路叠加)。
                if ("p2".equals(rule.getZone())) {
                    long nullW = mems.stream().filter(m -> m.getWeight() == null).count();
                    if (nullW > 0)
                        ctx.warnings().add("池「" + rule.getName() + "」有 " + nullW
                            + " 户成员未设层份(weight),已走楼层分桶,请补层份档案(S13 全员显式约定)");
                    else {
                        String w = weightCoefWarn(rule.getName(), mems.stream()
                            .map(AllocRuleMember::getWeight).reduce(BigDecimal.ZERO, BigDecimal::add), p.base());
                        if (w != null) ctx.warnings().add(w);
                    }
                }
                Map<Integer, BigDecimal> amtOf = new LinkedHashMap<>();
                for (AllocRuleMember m : mems)   // 显式份额=人工覆盖,一字不改(账册已核对的 rule 49/77 靠它)
                    if (m.getWeight() != null) amtOf.put(m.getTenantId(), r2(perFloor.multiply(m.getWeight())));
                // weight 为空的户:按 §D.1 解析楼层分桶,一层一份 perFloor(桶内 Σ面积>0 按面积拆,=0 按户数均分)
                List<FloorMember> byFloor = new ArrayList<>();
                for (AllocRuleMember m : mems) {
                    if (m.getWeight() != null) continue;
                    FloorSources fs = memberFloorSources(m.getTenantId(), rule.getBuildingId(),
                        ctx.unitsByTenant(), ctx.metersByTenant());
                    // §E4 两源冲突:仍按合同单元计(不反转优先级),但点名到户
                    String conflict = floorConflictWarn(rule.getName(),
                        ctx.nameByTenant().getOrDefault(m.getTenantId(), "#" + m.getTenantId()), fs);
                    if (conflict != null) ctx.warnings().add(conflict);
                    byFloor.add(new FloorMember(m.getTenantId(), fs.chosen(), nz(areaOf.get(m.getTenantId()))));
                }
                if (!byFloor.isEmpty()) {
                    // 刀二:电梯池首层桶整桶不摊(纸约「首层租户不承担电梯维保费和维修费」;
                    // B座货梯先例 2/3/4F 各 1 份);消防/楼层公共每层价含首层,照旧
                    boolean skip1F = FEE_ELEVATOR.equals(rule.getFeeKey());
                    FloorSplit split = floorBuckets(byFloor, perFloor, skip1F);
                    amtOf.putAll(split.amounts());
                    // 「未定层」桶照样算 1 份(不摊=白丢钱,比摊错更糟),但必须点名要人去补主数据
                    if (split.unknownCount() > 0)
                        ctx.warnings().add("池「" + rule.getName() + "」有 " + split.unknownCount()
                            + " 户定不出楼层,已按 1 层合摊,请补合同单元或该户户内表楼层");
                    // §E5 桶数超账册分母(floor 池 base_key 恒为空 → base=coefficient,月行覆盖已在 base 里解析)
                    String over = floorCoefWarn(rule.getName(), floorBucketsOf(byFloor, skip1F).size(), p.base(),
                        amtOf.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add), cost);
                    if (over != null) ctx.warnings().add(over);
                }
                for (AllocRuleMember m : mems) {
                    BigDecimal amt = amtOf.get(m.getTenantId());
                    if (amt == null) continue;
                    BigDecimal qtyShare = cost.signum() == 0 ? null
                        : r2(qty.multiply(amt).divide(cost, 10, RoundingMode.HALF_UP));
                    out.add(new Contribution(m.getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                        qtyShare, amt, perFloor, effPrice, null));
                }
            }
            case "ref" -> {   // S13 §4 V64 加价档:纯标准池按显式层份直供,户=std×weight;无 weight 成员不摊
                BigDecimal std = p.std();
                if (std == null) break;
                for (AllocRuleMember m : mems)
                    if (m.getWeight() != null)
                        out.add(new Contribution(m.getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                            null, r2(std.multiply(m.getWeight())), std, effPrice, null));
            }
            default -> { }
        }
        if (!noArea.isEmpty())
            ctx.warnings().add("池「" + rule.getName() + "」自动受益人有 " + noArea.size()
                + " 户在本期别无租赁面积(该户本期合同,多场地户的外区面积不计入),未参与分摊" + suffix(noArea));
        // 反向防线:名册面积Σ 与池面积基数(base)不是同一批户时会「多收」——凭空生出的钱同样不能静默
        if (auto) {
            BigDecimal sum = out.stream().map(Contribution::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (sum.compareTo(cost) > 0) {
                // ⭐把「该填多少」也算出来:只说基数不对、不给目标值,用户在抽屉里照样不知道往里写什么。
                // 名册Σ = 参与分摊那批户的份额基数和(area 池即面积㎡,与 std 同分母口径),正是基数应有的值。
                // 按层池(base 恒 null)算不出这个数 → 不编,只报差额。
                BigDecimal rosterArea = out.stream().map(Contribution::base).filter(Objects::nonNull)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
                ctx.warnings().add("池「" + rule.getName() + "」自动名册已分摊 " + r2(sum) + " 元 超出应分摊 "
                    + r2(cost) + " 元(面积基数填的是 " + p.base() + ")"
                    + (rosterArea.signum() == 0 ? ",请核对基数或改人工勾选受益人"
                        : " —— 本月在租名册面积Σ 只有 " + r2(rosterArea)
                          + ",请在池抽屉把「基数」改成 " + r2(rosterArea) + ",或改人工勾选受益人"));
            }
        }
        return out;
    }

    // ── 损耗链(§2.4):楼栋(组)级 总表vs分表 残差 → 收取率 I → 户损耗费=户用电×I×price_loss ──
    // 组定义:默认每楼栋自成组(有 infra 总表);共用总表(二期二/三/四车间)用 alloc_cfg
    // scope=building:{id}, key=loss_head, value=头栋 building_id 归组——加行不加列。
    private record LossGroup(Integer headBuildingId, String zone, List<Integer> buildingIds,
                             BigDecimal headQty, BigDecimal subQty, BigDecimal cableQty, boolean hasSub) {}

    // 组D(分表Σ)成员:租户表+公摊表+park 园区自担表。park 既不向租户收也不进公摊分摊,
    // 但物理上仍挂在楼栋分表下(Excel S92 含 A座「创显办公室」r13),必须参与损耗残差 E=D−C(V68)。
    private static boolean inSubSigma(Meter m) {
        // V75 §E3.3/§F1 护栏:只排 shadow(疑似重复建档)—— 同一块物理表两份档案各带一条读数,
        // 计两次就是凭空多出的用量。suspect='incomplete'(档案不全但配不到重复对手)照常入Σ:
        // 5 块挂栋的 p2 临电就在这一档,排掉会让 E=D−C 长期偏低。集合过滤,不动任何公式。
        // 刀H §H2(V79):新增的 ownership='register'(非计费计度寄存器:反向有功/需量等附属读数)
        // 由下面这个**白名单**天然排除。
        // ⚠2026-08-09 修订刀H的物理判断:源册「二期园区损耗」S56 分表Σ**确实计入**了那条 15527 度
        // 无名行(S51,紧挨永龙,prev 空 → N×倍率整段入Σ)——册面就是这么算的,不计入它,二三四车间
        // 合并链率会从 0.0255 飙到 0.2067(16 户/月多收 ≈7,123)。故该行按 ownership='park' 建档
        // (园区自担:入损耗 D Σ、不向任何户计费),见 p2-loss-s51-park-meter-20260809.sql。
        if ("shadow".equals(m.getSuspect())) return false;
        String o = m.getOwnership();
        return "tenant".equals(o) || "share".equals(o) || "park".equals(o);
    }

    private List<LossGroup> lossGroups(Ctx ctx) {
        // 楼栋 → head 楼栋(loss_head 参数,默认自身)
        Map<Integer, Integer> headOf = new HashMap<>();
        Map<Integer, BigDecimal> headQty = new HashMap<>(), subQty = new HashMap<>(), cableQty = new HashMap<>();
        Map<Integer, String> zoneOf = new HashMap<>();
        Set<Integer> hasSub = new HashSet<>();
        Map<Integer, List<Integer>> memberBuildings = new LinkedHashMap<>();
        for (Meter m : ctx.meterById().values()) {
            if (m.getBuildingId() == null || !"elec".equals(m.getKind()) || "dorm".equals(m.getZone())) continue;
            // 供电侧总表(zone.loss_supply_meter)只做对账供给边,不入损耗组(真实档案 B-G座总电=infra+挂栋)
            BigDecimal sup = cfgVal(ctx, m.getZone(), "loss_supply_meter");
            if (sup != null && sup.intValue() == m.getId()) continue;
            // 抄表册段落Σ明确剔除的行(四车间工地/力美C201电/广告字分表等)不入 C/D(V66 配置)
            BigDecimal mex = cfgVal(ctx, "meter:" + m.getId(), "loss_exclude");
            if (mex != null && mex.signum() != 0) continue;
            int bid = m.getBuildingId();
            Integer head = headOf.computeIfAbsent(bid, b -> {
                BigDecimal h = cfgVal(ctx, "building:" + b, "loss_head");
                return h == null ? b : h.intValue();
            });
            MeterReading r = ctx.readingByMeter().get(m.getId());
            BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
            zoneOf.putIfAbsent(head, m.getZone());
            memberBuildings.computeIfAbsent(head, k -> new ArrayList<>());
            if (!memberBuildings.get(head).contains(bid)) memberBuildings.get(head).add(bid);
            if (inSubSigma(m)) hasSub.add(head);
            if (u == null) continue;
            if ("infra".equals(m.getOwnership())) {
                // §F3:shadow 总表同样不进组C —— 一块重复建档的总表进 C,与一块重复分表进 D 是同一种重复计量。
                // (分表侧由 inSubSigma 排除,infra 走 headQty 分支不过它,故在此单独挡一次)
                if ("shadow".equals(m.getSuspect())) continue;
                // 铝缆表仅陈列,不入 C/D(POOL-ENGINE-SPEC §3.4)
                if (m.getName() != null && m.getName().contains("铝缆")) cableQty.merge(head, u, BigDecimal::add);
                else {
                    // loss_c_meter:组C只取指定总表(一期A座只引S5),其余 infra 不入C也不入D(Excel S92 排除自装总表等)
                    BigDecimal cm = cfgVal(ctx, "building:" + head, "loss_c_meter");
                    if (cm == null || cm.intValue() == m.getId()) headQty.merge(head, u, BigDecimal::add);
                }
            } else if (inSubSigma(m)) subQty.merge(head, u, BigDecimal::add);
        }
        List<LossGroup> out = new ArrayList<>();
        for (Map.Entry<Integer, List<Integer>> e : memberBuildings.entrySet()) {
            BigDecimal c = headQty.get(e.getKey());
            if (c == null) continue;   // 无总表读数=该组本月不出损耗率(抄表屏黄标提示)
            out.add(new LossGroup(e.getKey(), zoneOf.get(e.getKey()), e.getValue(),
                c, nz(subQty.get(e.getKey())), cableQty.get(e.getKey()), hasSub.contains(e.getKey())));
        }
        return out;
    }

    // 一期分摊用电度数G基数=ROUND(Σ(fee_key='park_loss_pool' 的 p1 规则当月净量)/park_share_div,2)(86.8 度/栋);
    // 二期无此项=0。原册 `一期园区损耗!G4/G6..G10 = ROUND(SUM(公共电分摊明细!S5:S9)/6,2)` 取的是 r5–r9 **五行的 Σ**,
    // 不是某个池的量 —— 刀I(V84)把原来折成一条 loss 池的 r5/r6/r7/r9 拆回 4 条独立行、并把 r8 招商中心(净额行)
    // 一并标成该费键,连同 fold_qty 折入链一起删。取数口径本就是「按费键求 Σ」,故这里一行未动:
    // 刀前 Σ=单池 520.82(含折入的 152.06),刀后 Σ=29.51+18.55+101.51+219.19+152.06=520.82,逐格相等。
    // 单行仍是池净量(含 sign 净额扣度,招商中心 S8=X50−670 走这条)。
    private BigDecimal shareQtyOf(String zone, Ctx ctx) {
        if (!"p1".equals(zone)) return BigDecimal.ZERO;
        BigDecimal div = cfgVal(ctx, "p1", "park_share_div");
        if (div == null || div.signum() == 0) return BigDecimal.ZERO;
        BigDecimal sum = BigDecimal.ZERO;
        Map<Integer, SegQty> memo = new HashMap<>();
        for (AllocRule rule : ctx.ruleList()) {
            if (!PARK_POOL.equals(rule.getFeeKey()) || !"p1".equals(rule.getZone())) continue;
            SegQty q = poolSegQty(rule, ctx, memo, new ArrayDeque<>());
            if (q.any()) sum = sum.add(q.total());
        }
        return r2(sum.divide(div, 10, RoundingMode.HALF_UP));
    }

    // 损耗变体(§3.4):组内无分表=none 不出率;否则按 building:{head}.loss_variant(0=net默认/1=share_only/2=陈列不出率)
    private String lossVariant(LossGroup g, Ctx ctx) {
        if (!g.hasSub()) return "none";
        BigDecimal v = cfgVal(ctx, "building:" + g.headBuildingId(), "loss_variant");
        if (v != null && v.intValue() == 2) return "none";   // 一期G座:独立供电链仅陈列,不出率(Excel r11/r12 无损耗核算)
        return v != null && v.intValue() == 1 ? "share_only" : "net";
    }

    // G 列(仅 p1):公摊池均摊 + building:{head}.loss_g_adj(一期A座 -1500);二期 null
    private BigDecimal groupG(LossGroup g, Ctx ctx) {
        if (!"p1".equals(g.zone())) return null;
        return nz(shareQtyOf(g.zone(), ctx)).add(nz(cfgVal(ctx, "building:" + g.headBuildingId(), "loss_g_adj")));
    }

    private BigDecimal lossPrice(String zone, Ctx ctx) {
        BigDecimal p = cfgVal(ctx, zone, "price_loss");
        return p != null ? p : cfgVal(ctx, zone, "price_flat");   // 一期损耗按商业价回退
    }

    private List<Contribution> lossContributions(Ctx ctx) {
        List<Contribution> out = new ArrayList<>();
        for (LossGroup g : lossGroups(ctx)) {
            BigDecimal rate = groupRate(g, ctx);
            BigDecimal priceLoss = lossPrice(g.zone(), ctx);
            if (rate == null || rate.signum() == 0 || priceLoss == null) continue;
            // 受益人=组内当月有用电量的全部租户(loss 规则无 member,动态取,§1)
            Map<Integer, BigDecimal> usageByTenant = new HashMap<>();
            for (Meter m : ctx.meterById().values()) {
                if (m.getTenantId() == null || !"tenant".equals(m.getOwnership())
                        || m.getBuildingId() == null || !g.buildingIds().contains(m.getBuildingId())
                        || !"elec".equals(m.getKind())) continue;
                MeterReading r = ctx.readingByMeter().get(m.getId());
                BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
                if (u != null && u.signum() > 0) usageByTenant.merge(m.getTenantId(), u, BigDecimal::add);
            }
            // S13 §6 形态D(氙明/威玛斯):纯公摊户(链内零户表)也是损耗受益人——源册按(电梯+消防)×率收。
            // 仅 p2:组内车间池(floor/ref)显式正权成员补零度 stub,E2 账单侧按公摊行金额计 base;
            // 一期不动(锚点已闭合,分桶常态不同)。已有用电户 putIfAbsent 不重复。
            // ⚠双闸(实测教训):①规则自身 zone 也必须是 p2——只查"楼栋∈链"时,一期池(rule 49 楼梯间,
            // 带权成员含已不在档的老租户)会在楼栋 id 碰撞时被误当受益人;②成员必须在租户档案里,
            // 幽灵成员直通 bill_notice 会撞 fk_notice_tenant。
            if ("p2".equals(g.zone()))
                for (AllocRule r : ctx.ruleList()) {
                    if (!"p2".equals(r.getZone()) || r.getBuildingId() == null
                            || !g.buildingIds().contains(r.getBuildingId())
                            || !("floor".equals(r.getMethod()) || "ref".equals(r.getMethod()))) continue;
                    for (AllocRuleMember m : ctx.membersByRule().getOrDefault(r.getId(), List.of()))
                        if (m.getWeight() != null && m.getWeight().signum() > 0
                                && ctx.nameByTenant().containsKey(m.getTenantId()))
                            usageByTenant.putIfAbsent(m.getTenantId(), BigDecimal.ZERO);
                }
            // S4-3 E2:携链信息(成员楼栋+链名)供出账引擎按链计金额口径;度数口径 amount 原样保留(alloc_result 契约不动)
            String chainName = g.buildingIds().stream()
                .map(bid -> { Building b = ctx.buildingById().get(bid); return b == null ? "#" + bid : b.getName(); })
                .reduce((a, b) -> a + "+" + b).orElse("#" + g.headBuildingId());
            for (Map.Entry<Integer, BigDecimal> e : usageByTenant.entrySet()) {
                out.add(new Contribution(e.getKey(), FEE_LOSS, null, null, r2(e.getValue()),
                    lossFee(e.getValue(), rate, priceLoss), rate, priceLoss, null,
                    null, g.buildingIds(), chainName));
            }
        }
        return out;
    }

    private BigDecimal groupAdjQty(LossGroup g, Ctx ctx) {
        BigDecimal adjQty = BigDecimal.ZERO;
        for (Integer bid : g.buildingIds()) adjQty = adjQty.add(nz(cfgVal(ctx, "building:" + bid, "loss_adj_qty")));
        return adjQty;
    }

    private BigDecimal groupRate(LossGroup g, Ctx ctx) {
        String variant = lossVariant(g, ctx);
        if ("none".equals(variant)) return null;
        BigDecimal lossQty = g.subQty().subtract(g.headQty());   // E=分表Σ−总表(负=有损耗)
        BigDecimal adjRate = nz(cfgVal(ctx, "building:" + g.headBuildingId(), "loss_adj_rate"));
        return tenantLossRate(variant, lossQty, groupG(g, ctx), groupAdjQty(g, ctx), adjRate, g.headQty());
    }

    private List<AllocLossRowDTO> lossTable(Ctx ctx) {
        List<AllocLossRowDTO> out = new ArrayList<>();
        for (LossGroup g : lossGroups(ctx)) {
            BigDecimal lossQty = g.subQty().subtract(g.headQty());
            BigDecimal rawRate = g.headQty().signum() == 0 ? null
                : r4(lossQty.divide(g.headQty(), 10, RoundingMode.HALF_UP));
            String name = g.buildingIds().stream()
                .map(bid -> { Building b = ctx.buildingById().get(bid); return b == null ? "#" + bid : b.getName(); })
                .reduce((a, b) -> a + "+" + b).orElse("#" + g.headBuildingId());
            out.add(new AllocLossRowDTO(g.zone(), g.headBuildingId(), name,
                r2(g.headQty()), r2(g.subQty()), r2(lossQty), rawRate,
                nz(groupG(g, ctx)), r2(groupAdjQty(g, ctx)),
                cfgVal(ctx, "building:" + g.headBuildingId(), "loss_adj_rate"),
                groupRate(g, ctx)));
        }
        out.sort(Comparator.comparing(AllocLossRowDTO::zone).thenComparing(AllocLossRowDTO::buildingId));
        return out;
    }

    private BigDecimal zoneLossAllocated(String zone, Ctx ctx) {
        // 本月 share_elec_loss 现算Σ(按组 zone 过滤)
        BigDecimal sum = BigDecimal.ZERO;
        for (LossGroup g : lossGroups(ctx)) {
            if (!zone.equals(g.zone())) continue;
            BigDecimal rate = groupRate(g, ctx);
            BigDecimal priceLoss = lossPrice(zone, ctx);
            if (rate == null || priceLoss == null) continue;
            for (Meter m : ctx.meterById().values()) {
                if (m.getTenantId() == null || !"tenant".equals(m.getOwnership())
                        || m.getBuildingId() == null || !g.buildingIds().contains(m.getBuildingId())
                        || !"elec".equals(m.getKind())) continue;
                MeterReading r = ctx.readingByMeter().get(m.getId());
                BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
                if (u != null && u.signum() > 0) sum = sum.add(lossFee(u, rate, priceLoss));
            }
        }
        return sum;
    }

    // ══════════ 池核算引擎(POOL-ENGINE-SPEC §3) ══════════
    private static final String PARK_POOL = "park_loss_pool";

    private record SegQty(boolean any, BigDecimal total, BigDecimal sharp, BigDecimal peak,
                          BigDecimal flat, BigDecimal valley, String warn) {}

    // (包内可见:单测直接断言 MANUAL_POOL 的每一格)
    record PoolCalc(BigDecimal qtyTotal, BigDecimal sharp, BigDecimal peak, BigDecimal flat,
                    BigDecimal valley, BigDecimal extra, BigDecimal cost, BigDecimal base,
                    BigDecimal std, BigDecimal foldAdd, BigDecimal price, String warn) {}

    // §H4.2e 无表行(method=manual,原册 r12/r47/48/49)的池结果:十二格全空。
    // warn 也必须是 null —— 没有表可抄,报「缺读数」是假警报。
    static final PoolCalc MANUAL_POOL =
        new PoolCalc(null, null, null, null, null, null, null, null, null, null, null, null);

    private static AllocRule ruleOf(Ctx ctx, Integer id) {
        for (AllocRule r : ctx.ruleList()) if (r.getId().equals(id)) return r;
        return null;
    }

    private static List<AllocRuleLink> linksOf(Ctx ctx, Integer dst, String type) {
        List<AllocRuleLink> out = new ArrayList<>();
        for (AllocRuleLink l : ctx.linkList())
            if (l.getDstRuleId().equals(dst) && type.equals(l.getLinkType())) out.add(l);
        return out;
    }

    // S21 §2.4 池默认列归一:加度/分母只有 alloc_cfg rule:{id} 一条版本链(V97 把旧默认列搬成 '' from 行),
    // 不再回退 alloc_rule.extra_qty/coefficient 两列(恒 0/NULL,仅历史)。
    private BigDecimal poolExtra(AllocRule rule, Ctx ctx) {
        return nz(cfgVal(ctx, "rule:" + rule.getId(), "extra_qty"));
    }

    private BigDecimal coefficientOf(AllocRule rule, Ctx ctx) {
        return cfgVal(ctx, "rule:" + rule.getId(), "coefficient");
    }

    private boolean isNetPool(AllocRule rule, Ctx ctx) {
        for (AllocRuleMeter b : ctx.bindsByRule().getOrDefault(rule.getId(), List.of()))
            if (b.getSign() != null && b.getSign() < 0) return true;
        return false;
    }

    // 池各段用量=Σ(绑定表段用量×sign)+fold_qty链入(§3.1);manual_qty(rule月行)整体替代表用量(宿舍绿化水84吨);
    // 净额池(含sign=-1) extra_qty 直接并入净量(招商净电 S8=X50-670 复刻);环=409
    private SegQty poolSegQty(AllocRule rule, Ctx ctx, Map<Integer, SegQty> memo, Deque<Integer> stack) {
        SegQty cached = memo.get(rule.getId());
        if (cached != null) return cached;
        if (stack.contains(rule.getId()))
            throw new BizException(ResultCode.CONFLICT, "折入链存在环:规则「" + rule.getName() + "」");
        stack.push(rule.getId());
        BigDecimal total = BigDecimal.ZERO, sharp = BigDecimal.ZERO, peak = BigDecimal.ZERO,
            flat = BigDecimal.ZERO, valley = BigDecimal.ZERO;
        boolean any = false, net = false;
        List<String> warns = new ArrayList<>();
        BigDecimal manual = cfgVal(ctx, "rule:" + rule.getId(), "manual_qty");
        if (manual != null) { total = manual; any = true; }
        else {
            for (AllocRuleMeter b : ctx.bindsByRule().getOrDefault(rule.getId(), List.of())) {
                int sg = b.getSign() == null ? 1 : b.getSign();
                if (sg < 0) net = true;
                Meter m = ctx.meterById().get(b.getMeterId());
                // §F3 池侧真挡:池分母走显式 alloc_rule_meter 绑定,根本不经 inSubSigma —— 只挡楼栋分表Σ
                // 等于没挡(实测 meter 1139 已标 shadow 仍绑在 rule 61 上)。这里只跳过成员并落行级 warn,
                // 不动任何算式;绑到重复档案上是主数据错,warn 要点名让人去改绑真表。
                if (m != null && "shadow".equals(m.getSuspect())) {
                    warns.add("表『" + m.getName() + "』疑似重复建档,已排除出池分母,请改绑真档案");
                    continue;
                }
                MeterReading r = ctx.readingByMeter().get(b.getMeterId());
                BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
                if (u == null) {
                    warns.add("表『" + (m == null ? "#" + b.getMeterId() : m.getName()) + "』缺抄");
                    continue;
                }
                any = true;
                BigDecimal s = BigDecimal.valueOf(sg);
                total = total.add(u.multiply(s));
                BigDecimal uS = MeterService.usage(r.getPrevSharp(), r.getCurrSharp(), r.getFactorSnap());
                BigDecimal uP = MeterService.usage(r.getPrevPeak(), r.getCurrPeak(), r.getFactorSnap());
                BigDecimal uF = MeterService.usage(r.getPrevFlat(), r.getCurrFlat(), r.getFactorSnap());
                BigDecimal uV = MeterService.usage(r.getPrevValley(), r.getCurrValley(), r.getFactorSnap());
                // sign=-1 剔除表只有总读数无分时 → 总量落平段冲减(复刻 Excel 五车间电梯 L87=平1013.2-670.06)
                if (sg < 0 && uS == null && uP == null && uF == null && uV == null) uF = u;
                sharp = sharp.add(nz(uS).multiply(s));
                peak = peak.add(nz(uP).multiply(s));
                flat = flat.add(nz(uF).multiply(s));
                valley = valley.add(nz(uV).multiply(s));
            }
            if (net && any) total = total.add(poolExtra(rule, ctx));
        }
        for (AllocRuleLink l : linksOf(ctx, rule.getId(), "fold_qty")) {
            AllocRule src = ruleOf(ctx, l.getSrcRuleId());
            if (src == null) continue;
            SegQty s = poolSegQty(src, ctx, memo, stack);
            if (!s.any()) { warns.add("折入源「" + src.getName() + "」缺抄"); continue; }
            any = true;
            total = total.add(s.total()); sharp = sharp.add(s.sharp()); peak = peak.add(s.peak());
            flat = flat.add(s.flat()); valley = valley.add(s.valley());
        }
        stack.pop();
        SegQty q = new SegQty(any, total, sharp, peak, flat, valley,
            warns.isEmpty() ? null : String.join(";", warns));
        memo.put(rule.getId(), q);
        return q;
    }

    // 逐表明细快照(V73,原册一表一行):按池展开绑定表,落 行至/倍率/各段用量/该表应分摊。
    // 应分摊只在「逐表 ROUND 再求和」口径下才是逐表的真实数(p1/dorm 非净额非手输池,复刻账册 AD 列);
    // p2 是池级一次 ROUND、净额池/手输量池是整池一次 ROUND —— 这些池逐表金额不存在,落 NULL,
    // 屏上该列由池行 rowspan 显池级合计。**绝不按比例把池金额摊回逐表冒充逐表数。**
    private List<AllocPoolMeterResult> poolMeterLines(AllocRule rule, Ctx ctx, PoolCalc pc, LocalDateTime now) {
        List<AllocRuleMeter> binds = ctx.bindsByRule().getOrDefault(rule.getId(), List.of());
        if (binds.isEmpty()) return List.of();
        // 刀I §I2:净额池整池不出逐表行 —— 只改「哪些表出行」,算式一格未动(池级 qty/cost 仍由 computePool 给)。
        // 依据:原册「公共电分摊明细」r8 只有一行(A8='招商中心电1'、S8=一期园区电!X50+N8=152.06),
        // 而这 7 块绑定表是「一期园区电」S44:S50 的中间量 —— 5 块 sign=-1 扣减表固然不是行,
        // 两块 sign=+1 总表(S49=697.60/S50=444.80)在这张 sheet 上同样没有行。逐表行照出会把
        // 原册 1 行撑成 2 行、且显 697.60/444.80 而不是净额 152.06,正是本刀要治的病。
        // 构成明细(含硬编码扣度 −670)改走 PoolRow.netParts 进 hover,见 §I2 与 netParts()。
        if (isNetPool(rule, ctx)) return List.of();
        boolean perMeterCost = !"p2".equals(rule.getZone())
            && !"ref".equals(rule.getMethod()) && !"carrier".equals(rule.getMethod())
            && !isNetPool(rule, ctx)
            && cfgVal(ctx, "rule:" + rule.getId(), "manual_qty") == null;
        BigDecimal price = pc.price();
        List<AllocPoolMeterResult> out = new ArrayList<>();
        int seq = 0;
        for (AllocRuleMeter b : binds) {
            Meter m = ctx.meterById().get(b.getMeterId());
            // §F3 补漏(2026-07-31):shadow 表已被 poolSegQty/cost 两侧排除,逐表明细行也必须跟着不出 ——
            // 否则屏上逐表行加起来 ≠ 池级合计,用户对不上账(账表相符优先于"陈列全部绑定表")。
            if (m != null && "shadow".equals(m.getSuspect())) continue;
            MeterReading r = ctx.readingByMeter().get(b.getMeterId());
            int sg = b.getSign() == null ? 1 : b.getSign();
            BigDecimal s = BigDecimal.valueOf(sg);
            AllocPoolMeterResult row = new AllocPoolMeterResult();
            row.setYm(ctx.ym()); row.setRuleId(rule.getId()); row.setMeterId(b.getMeterId());
            row.setSign(sg); row.setSeq(seq++); row.setGeneratedAt(now);
            if (r != null) {
                row.setFactorSnap(r.getFactorSnap());
                row.setPrevTotal(r.getPrevTotal()); row.setCurrTotal(r.getCurrTotal());
                BigDecimal u = MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
                if (u != null) {
                    row.setQtyTotal(r2(u.multiply(s)));
                    row.setQtySharp(segQty(r.getPrevSharp(), r.getCurrSharp(), r.getFactorSnap(), s));
                    row.setQtyPeak(segQty(r.getPrevPeak(), r.getCurrPeak(), r.getFactorSnap(), s));
                    row.setQtyFlat(segQty(r.getPrevFlat(), r.getCurrFlat(), r.getFactorSnap(), s));
                    row.setQtyValley(segQty(r.getPrevValley(), r.getCurrValley(), r.getFactorSnap(), s));
                    if (perMeterCost && price != null) row.setCostAmount(r2(u.multiply(s).multiply(price)));
                }
            } else if (m == null) row.setFactorSnap(null);
            out.add(row);
        }
        return out;
    }

    private static BigDecimal segQty(BigDecimal prev, BigDecimal curr, BigDecimal factor, BigDecimal sign) {
        BigDecimal u = MeterService.usage(prev, curr, factor);
        return u == null ? null : r2(u.multiply(sign));
    }

    // 门禁(§3.6):电价月推键缺当月→整zone拒绝生成(p2=分时四键;p1/dorm=商业价)
    private void priceGate(String ym, Ctx ctx) {
        Set<String> zones = new TreeSet<>();
        for (AllocRule r : ctx.ruleList()) if (!"share_water".equals(r.getFeeKey())) zones.add(r.getZone());
        for (String zone : zones) {
            List<String> keys = "p2".equals(zone)
                ? List.of("elec_sharp", "elec_peak", "elec_flat", "elec_valley")
                : List.of("elec_commercial");
            List<String> missing = new ArrayList<>();
            for (String k : keys) if (priceCfg.resolve(k, ym, null, zone) == null) missing.add(k);
            if (!missing.isEmpty())
                throw new BizException(ResultCode.BAD_REQUEST,
                    zone + " 缺 " + ym + " 电价(" + String.join("/", missing) + "),请先在价目管理录入当月电价再生成");
        }
    }

    private Map<Integer, PoolCalc> computePools(Ctx ctx) {
        Map<Integer, SegQty> memo = new HashMap<>();
        Map<Integer, PoolCalc> done = new LinkedHashMap<>();
        for (AllocRule rule : ctx.ruleList()) {
            if ("share_water".equals(rule.getFeeKey())) continue;   // 水占位不进池引擎
            computePool(rule, ctx, memo, done, new ArrayDeque<>());
        }
        return done;
    }

    // 单池核算(§3.2/§3.3,ROUND 时机按册复刻不可混用):
    // p2=池级一次ROUND(先净量后计价);p1=逐表行ROUND再Σ(净额池例外净量后一次ROUND);dorm 同 p1 且 price_override 优先
    private PoolCalc computePool(AllocRule rule, Ctx ctx, Map<Integer, SegQty> memo,
                                 Map<Integer, PoolCalc> done, Deque<Integer> stack) {
        PoolCalc cached = done.get(rule.getId());
        if (cached != null) return cached;
        // §H4.2e 无表行早退:manual 池没有绑定表,不参与用量与应分摊计算 → 直接给空结果。
        // ⚠这是本方法唯一的早退分支,下面的算式一格未动(红线例外,已在交付说明点名)。
        if ("manual".equals(rule.getMethod())) { done.put(rule.getId(), MANUAL_POOL); return MANUAL_POOL; }
        if (stack.contains(rule.getId()))
            throw new BizException(ResultCode.CONFLICT, "折入链存在环:规则「" + rule.getName() + "」");
        stack.push(rule.getId());
        String ym = ctx.ym(); String zone = rule.getZone();
        SegQty q = poolSegQty(rule, ctx, memo, new ArrayDeque<>());
        BigDecimal extra = poolExtra(rule, ctx);
        boolean net = isNetPool(rule, ctx);
        List<String> warns = new ArrayList<>();
        // 缺抄清单进 generate 返回的 warnings(V69:户级不再走 ruleUsage,缺抄上报改由此处一处出)
        if (q.warn() != null) { warns.add(q.warn()); ctx.warnings().add("池「" + rule.getName() + "」" + q.warn()); }

        // fold_price 叠加档=Σsrc.std(拓扑序:先递归算 src)
        BigDecimal foldAdd = null;
        for (AllocRuleLink l : linksOf(ctx, rule.getId(), "fold_price")) {
            AllocRule src = ruleOf(ctx, l.getSrcRuleId());
            if (src == null) continue;
            PoolCalc s = computePool(src, ctx, memo, done, stack);
            if (s.std() == null) { warns.add("折入源「" + src.getName() + "」无分摊标准"); continue; }
            foldAdd = nz(foldAdd).add(s.std());
        }

        BigDecimal cost = null, unrounded = null, price = null;
        if (q.any()) {
            if ("p2".equals(zone)) {
                BigDecimal mgmt = nz(priceCfg.resolve("mgmt_fee", ym, null, zone));
                BigDecimal pSharp = nz(priceCfg.resolve("elec_sharp", ym, null, zone)).add(mgmt);
                BigDecimal pPeak = nz(priceCfg.resolve("elec_peak", ym, null, zone)).add(mgmt);
                BigDecimal pFlat = nz(priceCfg.resolve("elec_flat", ym, null, zone)).add(mgmt);
                BigDecimal pValley = nz(priceCfg.resolve("elec_valley", ym, null, zone)).add(mgmt);
                BigDecimal ratio = priceCfg.resolve("sharp_as_peak_ratio", ym, null, zone);
                boolean hasTou = q.sharp().signum() != 0 || q.peak().signum() != 0
                    || q.flat().signum() != 0 || q.valley().signum() != 0;
                unrounded = hasTou
                    ? p2Unrounded(q.sharp(), q.peak(), q.flat(), q.valley(), pSharp, pPeak, pFlat, pValley, ratio)
                    : q.total().multiply(pFlat);   // 无分时段回退 平价×总量
                cost = r2(unrounded);
            } else {   // p1 / dorm:AB=商业价+商业维护费;rule:{id}.price_override 优先(宿舍化石价复刻)
                BigDecimal override = cfgVal(ctx, "rule:" + rule.getId(), "price_override");
                price = override != null ? override
                    : nz(priceCfg.resolve("elec_commercial", ym, null, zone))
                        .add(nz(priceCfg.resolve("mgmt_fee_commercial", ym, null, zone)));
                boolean manualPool = cfgVal(ctx, "rule:" + rule.getId(), "manual_qty") != null;
                if (net || manualPool) {
                    cost = r2(q.total().multiply(price));   // 净额池/手输量:净量后一次ROUND
                } else {
                    cost = BigDecimal.ZERO;                 // 逐表行ROUND再Σ(AD 列复刻,A座电梯=1011.18)
                    for (AllocRuleMeter b : ctx.bindsByRule().getOrDefault(rule.getId(), List.of())) {
                        // §F3 补漏(2026-07-31):qty 侧 poolSegQty 已跳过 shadow,金额侧这条循环当时被红线挡住没改,
                        // 结果混合池 cost 仍含重复表的钱 → cost≠qty×price,direct 池会把这份重复金额摊给租户。
                        // 与 poolSegQty 同一判定,保持两侧口径一致。
                        Meter sm = ctx.meterById().get(b.getMeterId());
                        if (sm != null && "shadow".equals(sm.getSuspect())) continue;
                        MeterReading r = ctx.readingByMeter().get(b.getMeterId());
                        BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
                        if (u == null) continue;
                        cost = cost.add(r2(u.multiply(BigDecimal.valueOf(b.getSign() == null ? 1 : b.getSign())).multiply(price)));
                    }
                    for (AllocRuleLink l : linksOf(ctx, rule.getId(), "fold_qty")) {   // 折入行按净量单行ROUND
                        SegQty s = memo.get(l.getSrcRuleId());
                        if (s != null && s.any()) cost = cost.add(r2(s.total().multiply(price)));
                    }
                }
                unrounded = q.total().multiply(price);
            }
        } else {
            // 三态挂零(V68/V87/V88):池有绑定记录、但当月全部不在服务中(bindsByRule 已被 V68 过滤成空)
            // =原册的"停用挂零"陈列(2023-10/2024-02 r124/r132 皆如此),不是缺抄——不报警不出"!"。
            // 从未绑表、在册却漏抄、折入源缺抄仍照报。
            boolean allOff = warns.isEmpty()
                && ctx.boundRules().contains(rule.getId())
                && ctx.bindsByRule().getOrDefault(rule.getId(), List.of()).isEmpty();
            if (!allOff) warns.add(0, "缺读数,本月未核算");
        }

        // 分摊标准 std(§3.3):未舍入值先除基数再ROUND;direct=cost;none=null;ref=只出std不出cost
        BigDecimal base = null, std = null;
        if (q.any()) {
            base = rule.getBaseKey() != null
                ? priceCfg.resolve(rule.getBaseKey(), ym, null, zone) : coefficientOf(rule, ctx);
            if (rule.getBaseKey() != null && base == null) warns.add("基数键 " + rule.getBaseKey() + " 未取到值");
            int scale = rule.getRoundScale() == null ? 2 : rule.getRoundScale();
            BigDecimal stdAdd = cfgVal(ctx, "rule:" + rule.getId(), "std_add");
            String kind = rule.getStdKind() != null ? rule.getStdKind()
                : ("p2".equals(zone) ? "amount_over_base" : "qty_price_over_base");
            std = switch (rule.getMethod()) {
                case "direct" -> cost;
                case "none" -> null;
                default -> switch (kind) {
                    case "amount_over_base" -> stdAmountOverBase(nz(unrounded), base, scale, foldAdd, stdAdd);
                    case "qty_over_base" -> stdQtyOverBase(q.total(), base, scale, foldAdd, stdAdd);
                    default -> stdQtyPriceOverBase(q.total(), net ? null : extra, base, price, scale, foldAdd, stdAdd);
                };
            };
        }
        // 纯标准行(ref)与冲减载体(carrier,V73 火炬园)都不出应分摊、不入合计:
        // carrier 的表已在别池以 sign=-1 冲减,钱走账单侧单独收,本行只陈列用量(账册 W89 为空)
        if ("ref".equals(rule.getMethod()) || "carrier".equals(rule.getMethod())) cost = null;

        stack.pop();
        PoolCalc pc = new PoolCalc(q.any() ? q.total() : null,
            q.any() ? q.sharp() : null, q.any() ? q.peak() : null,
            q.any() ? q.flat() : null, q.any() ? q.valley() : null,
            extra, cost, base, std, foldAdd, price,
            warns.isEmpty() ? null : String.join(";", warns));
        done.put(rule.getId(), pc);
        return pc;
    }

    // 损耗单元快照行(§3.4)
    private List<AllocLossResult> computeLossUnits(Ctx ctx) {
        List<AllocLossResult> out = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        for (LossGroup g : lossGroups(ctx)) {
            BigDecimal e = g.subQty().subtract(g.headQty());
            AllocLossResult r = new AllocLossResult();
            r.setYm(ctx.ym()); r.setZone(g.zone()); r.setHeadBuildingId(g.headBuildingId());
            r.setCQty(r2(g.headQty()));
            r.setCableQty(g.cableQty() == null ? null : r2(g.cableQty()));
            r.setDQty(r2(g.subQty())); r.setEQty(r2(e));
            r.setRawRate(g.headQty().signum() == 0 ? null : r4(e.divide(g.headQty(), 10, RoundingMode.HALF_UP)));
            r.setGQty(groupG(g, ctx));
            r.setAdjQty(r2(groupAdjQty(g, ctx)));
            r.setAdjRate(cfgVal(ctx, "building:" + g.headBuildingId(), "loss_adj_rate"));
            r.setVariant(lossVariant(g, ctx));
            r.setTenantRate(groupRate(g, ctx));
            r.setGeneratedAt(now);
            out.add(r);
        }
        return out;
    }

    // ── 池核算表(§4):config 左连当月快照;无快照月 generated=false 且数值列 null ──
    public AllocPoolDTOs.Pools pools(String ym) {
        requireYm(ym);
        Map<Integer, AllocPoolResult> snap = new HashMap<>();
        for (AllocPoolResult r : poolResults.selectByYm(ym)) snap.put(r.getRuleId(), r);
        Map<Integer, List<AllocRuleMeter>> bindsByRule = ruleMeters.selectList(null).stream()
            .collect(groupingBy(AllocRuleMeter::getRuleId));
        Map<Integer, List<AllocRuleLink>> linksByDst = ruleLinks.selectList(null).stream()
            .collect(groupingBy(AllocRuleLink::getDstRuleId));
        Map<Integer, Meter> meterById = new HashMap<>();
        for (Meter m : meters.selectList(null)) meterById.put(m.getId(), m);
        Map<Integer, Building> bById = new HashMap<>();
        for (Building b : buildings.selectList(null)) bById.put(b.getId(), b);
        List<AllocRule> all = new ArrayList<>(rules.selectByZone(null));   // sort_no 保 Excel 原行序
        Map<Integer, String> nameById = new HashMap<>();
        for (AllocRule r : all) nameById.put(r.getId(), r.getName());
        // V69 分组序:园区级 → 各楼栋按账册序(该栋最小 sortNo) → 组内 楼层(整栋在前) → 侧向 → sortNo
        Map<Integer, Integer> bldRank = new HashMap<>();
        for (AllocRule r : all)
            if (r.getBuildingId() != null)
                bldRank.merge(r.getBuildingId(), r.getSortNo() == null ? 0 : r.getSortNo(), Math::min);
        // V80 §H4.2b:有原册块的(一期 67 条)改按「原册块序 → 块内原册行序」,不再按 building_id ——
        // 按楼栋分带会把原册 A 座的两个块合并、把三行招商中心抽成第七条带,正是本次报障的结构根因。
        // 块序取块内最小 book_row(原册 7 个块本就是连续行区间);+1000 让有块的整体排在无块规则之后,
        // 避免块序与楼栋序数值撞车(屏按 zone 过滤,跨期先后无意义)。二期/宿舍无块 → 老路不变。
        Map<String, Integer> blockRank = new HashMap<>();
        for (AllocRule r : all)
            if (r.getBookBlock() != null)
                blockRank.merge(r.getBookBlock(), r.getBookRow() == null ? 0 : r.getBookRow(), Math::min);
        all.sort(Comparator
            .comparingInt((AllocRule r) -> r.getBookBlock() != null
                ? 1000 + blockRank.getOrDefault(r.getBookBlock(), 0)
                : r.getBuildingId() == null ? Integer.MIN_VALUE : bldRank.getOrDefault(r.getBuildingId(), 0))
            .thenComparingInt(r -> r.getBookRow() != null ? r.getBookRow()
                : r.getFloorLabel() == null ? Integer.MIN_VALUE
                : floorNum(r.getFloorLabel()) == null ? Integer.MAX_VALUE : floorNum(r.getFloorLabel()))
            .thenComparing(r -> r.getSide() == null ? "" : r.getSide())
            .thenComparingInt(r -> r.getSortNo() == null ? 0 : r.getSortNo()));
        // V73 逐表明细快照(按 rule 分组,mapper 已按 rule_id/seq 排序)
        Map<Integer, List<AllocPoolMeterResult>> lineByRule =
            poolMeterResults.selectByYm(ym).stream().collect(groupingBy(AllocPoolMeterResult::getRuleId));
        // 刀I §I2:净额池不落逐表快照,构成明细读时按当月读数现算(全库净额池 4 条,一次 selectByYm 够用)
        Map<Integer, MeterReading> rdByMeter = new HashMap<>();
        for (MeterReading rd : readings.selectByYm(ym)) rdByMeter.put(rd.getMeterId(), rd);
        // 受益人当月解析(版本组前滚 S14)+ 在租/单元号
        Map<Integer, List<AllocRuleMember>> memByRule = new HashMap<>();
        ruleMembers.selectList(null).stream().collect(groupingBy(AllocRuleMember::getRuleId))
            .forEach((rid, rws) -> memByRule.put(rid, pickMembers(rws, ym)));
        Roster roster = loadRoster(ym);
        // 刀D:受益人楼层与分桶明细读时现算(楼层不落库),与 generate 同一组纯函数,主数据未变即口径全等
        Map<Integer, List<Meter>> metersByTenant = tenantMeters(meterById.values().stream()
            .filter(m -> !MeterService.outOfService(m, ym)).toList());
        Map<String, BigDecimal> cfgEff = cfgEffective(ym);   // S21:无快照月的构成明细加度取当月生效参数(列已退出)
        List<AllocPoolDTOs.PoolRow> rows = new ArrayList<>();
        for (AllocRule r : all) {
            AllocPoolResult s = snap.get(r.getId());
            Building b = r.getBuildingId() == null ? null : bById.get(r.getBuildingId());
            List<AllocRuleMember> mems = memByRule.getOrDefault(r.getId(), List.of());
            Map<Integer, List<String>> floorsOf = new HashMap<>();
            for (AllocRuleMember m : mems)
                floorsOf.put(m.getTenantId(), memberFloor(m.getTenantId(), r.getBuildingId(),
                    roster.unitsByTenant(), metersByTenant));
            // §D.6:只有 floor 池才有分桶(显式份额户走人工覆盖,不进桶);电梯池首层桶已剔,明细串同口径
            String allocNote = !"floor".equals(r.getMethod()) ? null
                : floorNote(floorBucketsOf(mems.stream().filter(m -> m.getWeight() == null)
                    .map(m -> new FloorMember(m.getTenantId(), floorsOf.get(m.getTenantId()), null)).toList(),
                    FEE_ELEVATOR.equals(r.getFeeKey())));
            rows.add(new AllocPoolDTOs.PoolRow(r.getId(), r.getZone(), r.getName(),
                r.getBookBlock(), r.getBookKey(),
                b == null ? "园区级" : b.getName(),
                r.getMethod(), r.getStdKind(), r.getRoundScale(), r.getBaseKey(), r.getSortNo(), r.getNote(),
                r.getBuildingId(), b == null ? null : b.getName(),
                r.getFloorLabel(), r.getSide(), r.getFeeName(),
                poolName(r.getZone(), b == null ? null : b.getName(), r.getFloorLabel(), r.getSide(), r.getFeeName()),
                autoMembers(r, mems.isEmpty()),
                mems.stream()
                    .map(m -> new AllocPoolDTOs.PoolMember(m.getTenantId(), roster.nameOf(m.getTenantId()),
                        roster.unitNoOf(m.getTenantId(), r.getBuildingId(), r.getFloorLabel()), m.getWeight(),
                        roster.stateOf(m.getTenantId()),
                        blank(m.getAcctMonth()) ? "default" : "month",
                        floorsOf.getOrDefault(m.getTenantId(), List.of()).isEmpty() ? null
                            : String.join("、", floorsOf.get(m.getTenantId())))).toList(),
                bindsByRule.getOrDefault(r.getId(), List.of()).stream()
                    .map(m -> bindDTO(m, meterById.get(m.getMeterId()))).toList(),
                linksByDst.getOrDefault(r.getId(), List.of()).stream()
                    .map(l -> new AllocPoolDTOs.Link(l.getSrcRuleId(), nameById.get(l.getSrcRuleId()), l.getLinkType())).toList(),
                lineByRule.getOrDefault(r.getId(), List.of()).stream()
                    .map(ln -> lineDTO(ln, meterById.get(ln.getMeterId()))).toList(),
                netParts(bindsByRule.getOrDefault(r.getId(), List.of()), meterById, rdByMeter,
                    s == null ? cfgEff.get("rule:" + r.getId() + "|extra_qty") : s.getExtraQtySnap()),
                s == null ? null : s.getQtyTotal(), s == null ? null : s.getQtySharp(),
                s == null ? null : s.getQtyPeak(), s == null ? null : s.getQtyFlat(),
                s == null ? null : s.getQtyValley(),
                s == null ? null : s.getExtraQtySnap(), s == null ? null : s.getCostAmount(),
                s == null ? null : s.getBaseSnap(), s == null ? null : s.getStdValue(),
                s == null ? null : s.getFoldAdd(), s == null ? null : s.getPriceSnap(),
                s == null ? null : s.getAllocatedAmount(), s == null ? null : s.getGapAmount(),
                s == null ? null : s.getWarn(), allocNote));
        }
        return new AllocPoolDTOs.Pools(!snap.isEmpty(), rows);
    }

    // ══════════ V69 定位化候选与受益人变动(pool-candidates / member-diff) ══════════
    // 池可组成的表口径:公摊/园区自担/运营/基础设施(infra 由前端标注不预勾,契约已注明)
    private static final Set<String> POOL_OWNERSHIP = Set.of("share", "park", "ops", "infra");

    // 位置化表标签:「四楼西侧·电表①」——不再露内部标识名(用户 2026-07-30 拍板)
    // 电表标签(V73 补全)。原实现 head=spot?:name 只取「位置·表号」,B座天面 4 块表全变成「天面·电表①」,
    // 用户 2026-07-30 报障「给用户选择池里有哪些电表,全都是一个名字」—— 最能区分的三个字段都被扔了。
    // 新语义 = 账册「区域|楼层|企业名称|电表名称|表号」压成一行:区域·位置·用途·表号。
    // 用途取 tenant_name(=账册「企业名称」列原文,公摊表存的是「东侧货梯」这类用途描述),空则回退内部标识名。
    // V77 §G3:位置段缺了要说出来。原实现「非空段用 · 连接」,缺位置就静默少一截,
    // 屏上「招商中心·已停用·电表①」看不出是「没录位置」还是「不适用」(meter 219 优凯A305电 源册位置列本就是空的)。
    // 位置段优先级:spot 原文(解析不出楼层的也照原文显示) > 结构化楼层+方位(人工补的) > 占位。
    // 占位只在 area 非空时补 —— 园区级/跨栋表本就没有区域,不适用,不补。
    // 不从标识名反猜楼层(A305→三楼有误伤面),待补清单见 scripts/meter-loc-todo.tsv。
    static final String LOC_TODO = "(位置未录)";

    // 用途段(=原册 D 列「企业名称」,实为用电部位/归属):tenant_name 空则回退标识名。
    // 刀I §I3 起 MeterLine.useName 也取它 —— 屏上「池名称」列逐行显本行电表的用途,与标签口径一致。
    static String meterUse(Meter m) {
        return blank(m.getTenantName()) ? m.getName() : m.getTenantName().trim();
    }

    static String meterLabel(Meter m) {   // 包级可见=供 AllocServiceTest 直测
        String use = meterUse(m);
        // S13 §8:公摊/园区自担/运营/基础设施表无「租户位置」可录,占位不当待办催,显 '–';仅租户表保留提示
        String todo = m.getOwnership() != null && POOL_OWNERSHIP.contains(m.getOwnership()) ? "–" : LOC_TODO;
        String loc = !blank(m.getSpot()) ? m.getSpot()
            : !blank(m.getFloorLabel()) ? m.getFloorLabel().trim() + (blank(m.getSide()) ? "" : m.getSide().trim())
            : blank(m.getArea()) ? null : todo;
        return Stream.of(m.getArea(), loc, use, m.getSubName())
            .filter(s -> !blank(s)).map(String::trim).distinct().collect(Collectors.joining("·"));
    }

    private static AllocPoolDTOs.MeterLine lineDTO(AllocPoolMeterResult ln, Meter m) {
        return new AllocPoolDTOs.MeterLine(ln.getMeterId(),
            m == null ? "#" + ln.getMeterId() : meterLabel(m),
            m == null ? null : m.getArea(), m == null ? null : m.getSpot(),
            m == null ? null : m.getFloorLabel(), m == null ? null : meterUse(m),
            m == null ? null : m.getSubName(), m == null ? null : m.getMeterType(),
            m == null ? null : m.getCode(),
            ln.getSign(), ln.getFactorSnap(), ln.getPrevTotal(), ln.getCurrTotal(),
            ln.getQtyTotal(), ln.getQtySharp(), ln.getQtyPeak(), ln.getQtyFlat(), ln.getQtyValley(),
            ln.getCostAmount());
    }

    // 刀I §I2 净额构成:净额池的全部绑定表(sign=+1 总表 与 sign=-1 扣减表)+ 原册硬编码扣度,
    // 逐项有符号量相加 = 池净量。招商中心锚点:697.60+444.80−4.74−0−315.60−0−0−670 = 152.06。
    // 这些项在原册「公共电分摊明细」上都没有行,只作主行 hover 明细;非净额池返回空表。
    private static List<AllocPoolDTOs.NetPart> netParts(List<AllocRuleMeter> binds,
            Map<Integer, Meter> meterById, Map<Integer, MeterReading> rdByMeter, BigDecimal extra) {
        if (binds.stream().noneMatch(b -> b.getSign() != null && b.getSign() < 0)) return List.of();
        List<AllocPoolDTOs.NetPart> out = new ArrayList<>();
        for (AllocRuleMeter b : binds) {
            Meter m = meterById.get(b.getMeterId());
            int sg = b.getSign() == null ? 1 : b.getSign();
            MeterReading rd = rdByMeter.get(b.getMeterId());
            BigDecimal u = rd == null ? null
                : MeterService.usage(rd.getPrevTotal(), rd.getCurrTotal(), rd.getFactorSnap());
            out.add(new AllocPoolDTOs.NetPart(b.getMeterId(),
                m == null ? "#" + b.getMeterId() : meterLabel(m), sg,
                u == null ? null : r2(u.multiply(BigDecimal.valueOf(sg)))));
        }
        // 扣度不是电表(招商中心 N8 公式原文 `=-670`,写在「本月行至」列位):有值才出项,sign 按正负号
        if (extra != null && extra.signum() != 0)
            out.add(new AllocPoolDTOs.NetPart(null, "账册扣度", extra.signum(), r2(extra)));
        return out;
    }

    private static AllocPoolDTOs.MeterBind bindDTO(AllocRuleMeter b, Meter m) {
        int sign = b.getSign() == null ? 1 : b.getSign();
        if (m == null) return new AllocPoolDTOs.MeterBind(b.getMeterId(), "#" + b.getMeterId(), sign,
            "#" + b.getMeterId(), null, null, null);
        return new AllocPoolDTOs.MeterBind(b.getMeterId(), m.getName(), sign,
            meterLabel(m), m.getSpot(), m.getSubName(), m.getMeterType());
    }

    // V82 §H4.2a:一期定位归一后,规则的位置是原册 C 列的**一格**(『四楼西侧』/『天面』),
    // 而 meter 仍是 floor_label + side **两格**。合成标签末尾的方位由此剥出,否则一期池的表候选
    // 会整片落空(『四楼西侧』永远等不到 meter 的『四楼』)。无方位(『天面』/『二楼』/『负一层』)返回 null。
    static String sideOf(String label) {
        if (blank(label)) return null;
        String s = label.trim();
        return s.length() > 2 && (s.endsWith("东侧") || s.endsWith("西侧")) ? s.substring(s.length() - 2) : null;
    }

    // 表定位过滤(V74 改走结构化字段:原实现 spot.startsWith(floor)/contains(side) 靠自由文本前缀,
    // 「一楼101室」匹配不到「一楼」以外的写法、「天面 1」这类脏值直接落空)。楼栋 null=不限(园区级)。
    static boolean atLocation(Meter m, Integer buildingId, String floor, String side) {
        if (buildingId != null && !buildingId.equals(m.getBuildingId())) return false;
        String f = blank(floor) ? null : floor.trim();
        String s = blank(side) ? sideOf(f) : side.trim();                  // 二期照旧传两格;一期从一格里剥
        if (f != null && s != null && f.endsWith(s)) f = f.substring(0, f.length() - s.length());
        if (f != null && !f.equals(m.getFloorLabel())) return false;
        return s == null || s.equals(m.getSide());
    }

    // 在租三态(2026-07-30 修误报):yes=有非草稿合同起止齐全且与该月重叠(=MeterBindingService.covers);
    // unknown=没有能判定覆盖的合同,但存在缺起止日期的非草稿合同 —— 判不了,不能说人家退租
    // (实测全库 174 份非草稿合同/159 户缺日期,旧布尔口径把它们全写成「已退租」);
    // no=其余(有日期但都不覆盖 / 压根没有非草稿合同)。多合同取最优:yes > unknown > no。
    public static String inForceState(List<Contract> nonDraft, java.time.LocalDate first, java.time.LocalDate last) {
        boolean unknown = false;
        for (Contract c : nonDraft) {
            if (c.getStartDate() == null || c.getEndDate() == null) { unknown = true; continue; }
            if (MeterBindingService.covers(c, first, last)) return "yes";
        }
        return unknown ? "unknown" : "no";
    }

    // 当月在租名册(在租语义复用 MeterBindingService.covers:非草稿+起止齐全+月区间重叠)
    // stateByTenant=三态;unitsByTenant=在租合同带出的单元(房号按池定位取,不再随便抓一个)
    // unitById=单元全表索引,顺带带出来给 loadCtx 复用(层面积口径要它),省一次全表查
    private record Roster(Map<Integer, String> stateByTenant, Map<Integer, String> nameById,
                          Map<Integer, List<Unit>> unitsByTenant,
                          List<Contract> covering, Map<Integer, List<Unit>> unitsByContract,
                          Map<Integer, Unit> unitById) {
        String nameOf(Integer t) { return nameById.get(t); }
        String stateOf(Integer t) { return stateByTenant.getOrDefault(t, "no"); }
        // 房号按池定位取:同楼栋(池有楼层则楼层也须相符)的单元;取不到返回 null(宁可不显也不显无关房号)
        String unitNoOf(Integer t, Integer buildingId, String floorLabel) {
            Integer fn = floorNum(floorLabel);
            for (Unit u : unitsByTenant.getOrDefault(t, List.of())) {
                if (u.getUnitNo() == null) continue;
                if (buildingId != null && !buildingId.equals(u.getBuildingId())) continue;
                if (fn != null && !fn.equals(u.getFloor())) continue;
                return u.getUnitNo();
            }
            return null;
        }
    }

    private Roster loadRoster(String ym) {
        java.time.LocalDate first = java.time.LocalDate.parse(ym + "-01");
        java.time.LocalDate last = first.withDayOfMonth(first.lengthOfMonth());
        Map<Integer, Unit> unitById = new HashMap<>();
        for (Unit u : units.selectList(null)) unitById.put(u.getId(), u);
        Map<Integer, List<Integer>> extraUnits = new HashMap<>();
        for (ContractUnit cu : contractUnits.selectList(null))
            extraUnits.computeIfAbsent(cu.getContractId(), k -> new ArrayList<>()).add(cu.getUnitId());
        Map<Integer, String> nameById = new HashMap<>();
        for (Tenant t : tenants.selectList(null)) nameById.put(t.getId(), t.getCompanyName());
        // 合同全表拉一次两处用:三态口径(非草稿)与 covering 口径(月覆盖)的过滤条件不同,但取数是同一条
        // 无条件全表查 —— 查两遍除了多一次往返没有任何差别(P3-4)
        List<Contract> allContracts = contracts.selectList(null);
        Map<Integer, List<Contract>> nonDraftByTenant = new HashMap<>();
        for (Contract c : allContracts)
            if (c.getTenantId() != null && !"draft".equals(c.getStatus()))
                nonDraftByTenant.computeIfAbsent(c.getTenantId(), k -> new ArrayList<>()).add(c);
        Map<Integer, String> state = new HashMap<>();
        nonDraftByTenant.forEach((t, cs) -> state.put(t, inForceState(cs, first, last)));
        List<Contract> covering = allContracts.stream()
            .filter(c -> c.getTenantId() != null && MeterBindingService.covers(c, first, last)).toList();
        Map<Integer, List<Unit>> unitsByTenant = new HashMap<>();
        Map<Integer, List<Unit>> unitsByContract = new HashMap<>();
        for (Contract c : covering) {
            List<Unit> us = new ArrayList<>();
            if (c.getUnitId() != null && unitById.containsKey(c.getUnitId())) us.add(unitById.get(c.getUnitId()));
            for (Integer uid : extraUnits.getOrDefault(c.getId(), List.of()))
                if (unitById.containsKey(uid)) us.add(unitById.get(uid));
            unitsByContract.put(c.getId(), us);
            unitsByTenant.computeIfAbsent(c.getTenantId(), k -> new ArrayList<>()).addAll(us);
        }
        return new Roster(state, nameById, unitsByTenant, covering, unitsByContract, unitById);
    }

    // 该定位在租租户(preChecked=按合同预勾)。楼层→unit.floor 数字比对;
    // 侧向不参与过滤(unit 表无侧向字段,契约已注明:预勾到楼层粒度,勾错侧由人取消)
    private List<AllocPoolDTOs.TenantCand> tenantsAt(Roster ro, Integer buildingId, String floorLabel) {
        Integer fn = floorNum(floorLabel);
        Map<Integer, AllocPoolDTOs.TenantCand> out = new LinkedHashMap<>();
        for (Contract c : ro.covering()) {
            List<Unit> us = ro.unitsByContract().getOrDefault(c.getId(), List.of());
            boolean hit;
            if (buildingId == null) hit = true;                                    // 园区级池=全园在租租户
            else if (fn == null) hit = buildingId.equals(c.getBuildingId())        // 整栋:合同挂栋或单元在栋
                || us.stream().anyMatch(u -> buildingId.equals(u.getBuildingId()));
            else hit = us.stream().anyMatch(u -> buildingId.equals(u.getBuildingId()) && fn.equals(u.getFloor()));
            if (!hit) continue;
            String no = us.stream().filter(u -> buildingId == null || buildingId.equals(u.getBuildingId()))
                .map(Unit::getUnitNo).filter(Objects::nonNull).findFirst().orElse(null);
            out.putIfAbsent(c.getTenantId(), new AllocPoolDTOs.TenantCand(c.getTenantId(),
                ro.nameOf(c.getTenantId()), no, "yes", true));   // 候选出自 covering 合同,必然在租
        }
        return new ArrayList<>(out.values());
    }

    // §D.4:direct(户对户,41 个池)的受益人就是那一户,「该定位本月在租租户」对它毫无意义
    // ——用户截图里 C座一个 direct 池推了 13 户「新在租」就是这么来的。返回空数组 + 说明,不静默空。
    public AllocPoolDTOs.Candidates poolCandidates(String ym, Integer buildingId, String floor, String side,
                                                   String method) {
        requireYm(ym);
        Map<Integer, MeterReading> byMeter = new HashMap<>();
        for (MeterReading r : readings.selectByYm(ym)) byMeter.put(r.getMeterId(), r);
        List<AllocPoolDTOs.MeterCand> ms = new ArrayList<>();
        for (Meter m : meters.selectList(null)) {
            if (!POOL_OWNERSHIP.contains(m.getOwnership()) || MeterService.outOfService(m, ym)) continue;
            if (!atLocation(m, buildingId, floor, side)) continue;
            MeterReading r = byMeter.get(m.getId());
            ms.add(new AllocPoolDTOs.MeterCand(m.getId(), meterLabel(m), m.getSpot(), m.getSubName(),
                m.getMeterType(), m.getOwnership(),
                r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap())));
        }
        ms.sort(Comparator.comparing(AllocPoolDTOs.MeterCand::label));
        if ("direct".equals(method))
            return new AllocPoolDTOs.Candidates(ms, List.of(), "整笔归户池只摊给一户,不按定位推在租租户,请直接指定该户");
        return new AllocPoolDTOs.Candidates(ms, tenantsAt(loadRoster(ym), buildingId, floor), null);
    }

    // 受益人变动提醒:该定位本月在租租户 与 池当前受益人 的差集(页面提醒条;首次配置=全是 added)
    public List<AllocPoolDTOs.MemberDiff> memberDiff(String ym) {
        requireYm(ym);
        Roster ro = loadRoster(ym);
        Map<Integer, List<AllocRuleMember>> memByRule = new HashMap<>();
        ruleMembers.selectList(null).stream().collect(groupingBy(AllocRuleMember::getRuleId))
            .forEach((rid, rws) -> memByRule.put(rid, pickMembers(rws, ym)));
        Map<String, List<AllocPoolDTOs.TenantCand>> cache = new HashMap<>();
        List<AllocPoolDTOs.MemberDiff> out = new ArrayList<>();
        for (AllocRule r : rules.selectByZone(null)) {
            // loss=受益人生成时动态取;none 全额挂亏、ref 纯标准行、carrier 冲减载体、manual 无表行(§H4.2e)
            // 本就无受益人 → 不进提醒条;
            // direct=户对户,受益人由人指定的那一户,按定位推「新在租」纯属噪音(§D.4)
            if (Set.of("loss", "none", "ref", "direct", "carrier", "manual").contains(r.getMethod())
                    || "share_water".equals(r.getFeeKey())) continue;
            // 园区级 fallback 池:受益人跟着在租名册自动变,差集会把全园 130 户列成 added 把真提醒淹掉 → 不进提醒条
            if (autoMembers(r, memByRule.getOrDefault(r.getId(), List.of()).isEmpty())) continue;
            List<AllocPoolDTOs.TenantCand> cand = cache.computeIfAbsent(
                r.getBuildingId() + "|" + r.getFloorLabel(), k -> tenantsAt(ro, r.getBuildingId(), r.getFloorLabel()));
            List<AllocRuleMember> mems = memByRule.getOrDefault(r.getId(), List.of());
            Set<Integer> memIds = new HashSet<>();
            for (AllocRuleMember m : mems) memIds.add(m.getTenantId());
            Set<Integer> candIds = new HashSet<>();
            for (AllocPoolDTOs.TenantCand c : cand) candIds.add(c.tenantId());
            // 有侧向的池不产出 added:unit 表无侧向字段,候选只能到楼层粒度,同层对侧的户报成「新在租」纯属瞎猜
            // (可莱恩西侧池把东侧 5 户全报成新在租)。候选列表照旧列全楼层——那是给人勾的,不是"检测到变动"。
            // V82:一期方位已并进 floor_label 一格(『四楼西侧』),侧向抑制不能再只看 side 列 —— 否则
            // 归一后 A~F 座那 40 多个东/西侧池会同时开始把对侧的户报成「新在租」,正是本抑制要挡的噪音。
            boolean sided = !blank(r.getSide()) || sideOf(r.getFloorLabel()) != null;
            List<AllocPoolDTOs.TenantCand> added = sided ? List.<AllocPoolDTOs.TenantCand>of()
                : cand.stream().filter(c -> !memIds.contains(c.tenantId())).toList();
            // removed 只收确凿的 'no':缺日期判不了(unknown)不算退租,在租但不在本定位(yes)也不算
            List<AllocPoolDTOs.TenantCand> removed = mems.stream().filter(m -> !candIds.contains(m.getTenantId()))
                .filter(m -> "no".equals(ro.stateOf(m.getTenantId())))
                .map(m -> new AllocPoolDTOs.TenantCand(m.getTenantId(), ro.nameOf(m.getTenantId()),
                    ro.unitNoOf(m.getTenantId(), r.getBuildingId(), r.getFloorLabel()), "no", null)).toList();
            if (added.isEmpty() && removed.isEmpty()) continue;
            out.add(new AllocPoolDTOs.MemberDiff(r.getId(), r.getName(), added, removed));
        }
        return out;
    }

    // ── 楼栋损耗表(§4):units=快照;recon=读时派生(供电侧总表 vs 单元合计,loss_recon=0 排除) ──
    public AllocPoolDTOs.Loss loss(String ym) {
        requireYm(ym);
        List<AllocLossResult> units = lossResults.selectByYm(ym);
        Ctx ctx = loadCtx(ym);
        List<AllocPoolDTOs.LossUnit> unitRows = new ArrayList<>();
        Map<String, List<AllocLossResult>> byZone = new LinkedHashMap<>();
        for (AllocLossResult u : units) {
            unitRows.add(new AllocPoolDTOs.LossUnit(u.getHeadBuildingId(), lossLabel(u, ctx), u.getZone(),
                u.getCQty(), u.getCableQty(), u.getDQty(), u.getEQty(), u.getRawRate(),
                u.getGQty(), u.getAdjQty(), u.getAdjRate(), u.getVariant(), u.getTenantRate(), null));
            byZone.computeIfAbsent(u.getZone(), k -> new ArrayList<>()).add(u);
        }
        List<AllocPoolDTOs.LossRecon> recon = new ArrayList<>();
        for (Map.Entry<String, List<AllocLossResult>> e : byZone.entrySet()) {
            BigDecimal meterId = cfgVal(ctx, e.getKey(), "loss_supply_meter");
            if (meterId == null) continue;
            MeterReading r = ctx.readingByMeter().get(meterId.intValue());
            BigDecimal supply = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
            if (supply == null || supply.signum() == 0) continue;
            BigDecimal sumC = BigDecimal.ZERO, sumD = BigDecimal.ZERO;
            for (AllocLossResult u : e.getValue()) {
                BigDecimal inc = cfgVal(ctx, "building:" + u.getHeadBuildingId(), "loss_recon");
                if (inc != null && inc.signum() == 0) continue;   // 一期A座独立供电链路,排除对账
                sumC = sumC.add(nz(u.getCQty())); sumD = sumD.add(nz(u.getDQty()));
            }
            BigDecimal lossVsC = r2(sumC.subtract(supply)), lossVsD = r2(sumD.subtract(supply));
            recon.add(new AllocPoolDTOs.LossRecon(e.getKey(), r2(supply), r2(sumC), r2(sumD),
                lossVsC, r4(lossVsC.divide(supply, 10, RoundingMode.HALF_UP)),
                lossVsD, r4(lossVsD.divide(supply, 10, RoundingMode.HALF_UP))));
        }
        return new AllocPoolDTOs.Loss(!units.isEmpty(), unitRows, recon);
    }

    // 合并组标签:单栋=栋名;共享总表组="二/三/四车间(三车间供电)"
    private String lossLabel(AllocLossResult u, Ctx ctx) {
        Building head = ctx.buildingById().get(u.getHeadBuildingId());
        String headName = head == null ? "#" + u.getHeadBuildingId() : head.getName();
        List<String> names = new ArrayList<>();
        for (Building b : ctx.buildingById().values().stream()
                .sorted(Comparator.comparing(Building::getId)).toList()) {
            BigDecimal h = cfgVal(ctx, "building:" + b.getId(), "loss_head");
            int hid = h == null ? b.getId() : h.intValue();
            if (hid == u.getHeadBuildingId()) names.add(b.getName());
        }
        if (names.size() <= 1) return headName;
        return String.join("/", names) + "(" + headName + "供电)";
    }

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式非法(应为 YYYY-MM)");
    }
}
