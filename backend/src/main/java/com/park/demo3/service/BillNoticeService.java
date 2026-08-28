package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.BillDeliveryDTO;
import com.park.demo3.dto.BillNoteReq;
import com.park.demo3.dto.BillNoticeDTO;
import com.park.demo3.dto.BillNoticeDetailDTO;
import com.park.demo3.dto.BillNoticeGenResultDTO;
import com.park.demo3.dto.MeterBindingDTO;
import com.park.demo3.entity.BillNoteOverride;
import com.park.demo3.entity.BillingTermUnit;
import com.park.demo3.entity.Unit;
import com.park.demo3.entity.AllocPoolResult;
import com.park.demo3.entity.AllocRule;
import com.park.demo3.entity.AllocRuleMember;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.BillNoticeLine;
import com.park.demo3.entity.BillPayCompany;
import com.park.demo3.entity.Contract;
import com.park.demo3.entity.ContractBillingTerm;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.AllocPoolResultMapper;
import com.park.demo3.mapper.BillingTermUnitMapper;
import com.park.demo3.mapper.UnitMapper;
import com.park.demo3.mapper.AllocRuleMapper;
import com.park.demo3.mapper.AllocRuleMemberMapper;
import com.park.demo3.mapper.BillNoteOverrideMapper;
import com.park.demo3.mapper.BillNoticeLineMapper;
import com.park.demo3.mapper.BillNoticeMapper;
import com.park.demo3.mapper.BillPayCompanyMapper;
import com.park.demo3.mapper.ContractBillingTermMapper;
import com.park.demo3.mapper.ContractMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.park.demo3.mapper.TenantMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// 催缴单派生引擎(S4-BILL-NOTICE-SPEC §5 + BILL-DERIVE-SPEC §2/§3 判定树B):
// 单事务;幂等=先删本 ym 的 draft(与 void:uk_notice 不含 status,void 留着会撞重生成的新 draft)再插;
// 已确认/已导出(含历史 issued)的租户整户跳过并计入 warned/skippedConfirmed 摘要(S20 §1.3 重新生成保护)。
// 取价一律 PriceCfgService.resolveHit(scope/acctMonth 落审计链);公摊行取 AllocService.poolContributions
// (池快照口径);表→合同走 MeterBindingService.resolveBinding 行级快照。
@Service
public class BillNoticeService {
    private static final Pattern YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");
    private static final String[] SEGS = {"sharp", "peak", "flat", "valley"};
    private static final String CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
    private static final Pattern DIGITS = Pattern.compile("\\d+");   // S6 §2.1 最长连续数字段
    // fee_group 归组(V90):与迁移回填 CASE 同一口径
    private static final Set<String> WATER_GROUP = Set.of("water", "water_pipe", "share_green_water");
    // 孵化协议固定收取(包干)吞掉的公摊键:电侧四项、水侧一项(取证见 applyPackages)
    private static final Set<String> PKG_ELEC_SWALLOW = Set.of(
        "share_elec_floor", "share_elec_fire", "share_elec_elevator", "share_elec_light");
    private static final Set<String> PKG_WATER_SWALLOW = Set.of("share_green_water");
    private static final ObjectMapper JSON = new ObjectMapper();   // rent_free 解析(与 ContractService 同口径)

    private final BillNoticeMapper notices;
    private final BillNoticeLineMapper noticeLines;
    private final BillNoteOverrideMapper noteOverrides;
    private final MeterMapper meters;
    private final MeterReadingMapper readings;
    private final ContractMapper contracts;
    private final ContractBillingTermMapper billingTerms;
    private final TenantMapper tenants;
    private final ManagementCompanyMapper companies;
    private final BillPayCompanyMapper payMap;
    private final AllocRuleMapper rules;
    private final AllocRuleMemberMapper ruleMembers;
    private final AllocPoolResultMapper poolResults;
    private final UnitMapper units;                  // S17 §2.5b 单元候选(结构化楼层/单元号)
    private final BillingTermUnitMapper termUnits;   // S17 §2.5b 行级绑定 → 单元候选的 location 归属
    private final PriceCfgService price;
    private final AllocService alloc;
    private final MeterBindingService binding;

    public BillNoticeService(BillNoticeMapper notices, BillNoticeLineMapper noticeLines,
                             BillNoteOverrideMapper noteOverrides,
                             MeterMapper meters, MeterReadingMapper readings,
                             ContractMapper contracts, ContractBillingTermMapper billingTerms,
                             TenantMapper tenants, ManagementCompanyMapper companies,
                             BillPayCompanyMapper payMap, AllocRuleMapper rules,
                             AllocRuleMemberMapper ruleMembers,
                             AllocPoolResultMapper poolResults,
                             UnitMapper units, BillingTermUnitMapper termUnits,
                             PriceCfgService price,
                             AllocService alloc, MeterBindingService binding) {
        this.notices = notices; this.noticeLines = noticeLines; this.noteOverrides = noteOverrides;
        this.meters = meters; this.readings = readings;
        this.contracts = contracts; this.billingTerms = billingTerms;
        this.tenants = tenants; this.companies = companies;
        this.payMap = payMap; this.rules = rules; this.ruleMembers = ruleMembers;
        this.poolResults = poolResults;
        this.units = units; this.termUnits = termUnits;
        this.price = price; this.alloc = alloc; this.binding = binding;
    }

    // 行草稿(可变:损耗行 note 在户级汇总后补写);seq=构造序,场地段内保表序→段序
    private static final class L {
        Integer tenantId; boolean dorm; int seq;
        String feeKey, premise, meterLabel, seg, priceKey, priceScope, priceMonth, ruleBranch, shareSrc, note;
        String premiseWide;               // 合同级粗粒度场地键,仅损耗分桶用(见 wide())。
                                          // S6 把表行 premise 细化到单间后,损耗链两侧(表行细/公摊行仍合同级,
                                          // 规范 §4 明令不改)会裂成两个桶 → 行数与逐行金额都变,故分桶必须回到合同级。
        String feeGroup;                  // rent 派生行显式置 'rent';空=按 fee_key 归组(水电)
        String payCol;                    // rent 行拆单列(rentPayCol 预算);空=走 BillFeeMap.payCol(feeKey)
        Integer meterId, contractId, poolRuleId;
        BigDecimal prevRead, currRead, factorSnap, qty, priceSnap, baseSnap, amount;
        BigDecimal rateTmp;               // 链损耗率(E2:户级收尾按链基数×率定 amount)
        List<Integer> lossBuildings;      // 损耗链成员楼栋(E2 圈「链内行」用)
        String chainName;                 // 链名(A栋+B栋,进 note)
    }

    // ══════════ generate(ym) ══════════
    @Transactional
    public BillNoticeGenResultDTO generate(String ym) {
        requireYm(ym);
        LocalDate first = LocalDate.parse(ym + "-01");
        LocalDate last = first.withDayOfMonth(first.lengthOfMonth());
        String batch = "BN" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"));

        // 重新生成保护(S20 §1.3):已确认/已导出(含历史 issued)的户整户跳过 —— 这是防止已核对数据
        // 被静默覆盖的闸门。锁定户先算出来,再排除在删除范围外:否则该户「部分确认」时剩下的 draft
        // 会被删掉又因跳过而不重建,凭空少单。
        Set<Integer> lockedTenants = notices.selectList(new QueryWrapper<BillNotice>()
                .eq("ym", ym).in("status", "confirmed", "exported", "issued"))
            .stream().map(BillNotice::getTenantId).collect(Collectors.toSet());
        Set<Integer> confirmedTenants = notices.selectList(new QueryWrapper<BillNotice>()
                .eq("ym", ym).in("status", "confirmed", "exported"))
            .stream().map(BillNotice::getTenantId).collect(Collectors.toSet());
        // 幂等:draft 先删;void 一并清(uk_notice 不含 status,作废单留着会撞重生成的新 draft;行由 FK CASCADE 连删)
        QueryWrapper<BillNotice> del = new QueryWrapper<BillNotice>()
            .eq("ym", ym).in("status", "draft", "void");
        if (!lockedTenants.isEmpty()) del.notIn("tenant_id", lockedTenants);
        notices.delete(del);

        // ── 语境 ──
        Map<Integer, Meter> meterById = new HashMap<>();
        // Finding 1(白盒复检):这里仍是「首块表」猜期区,跟 AllocService.zoneOfBuilding(列优先,
        // building.zone 为唯一事实来源)不是同一份解析——本服务没有注入 BuildingMapper/Building 集合,
        // 直接改调 AllocService.zoneOfBuilding 得新开一条 building 全表查询,与本轮「复用现有加载、
        // 不加查询」的约束冲突(QueryHygieneTest 对 selectList(null) 是全等断言,新增一律不许进
        // LEGACY 表)。已确认没有能白嫖到 Building.zone 的现成集合,不强上,留作后续任务:注入
        // BuildingMapper + 补一条有界全表查(building ~30 行不逐月累积,同 ZoneService.java 的口径),
        // 同步把 QueryHygieneTest 的 BillNoticeService.java 计数从 10 改成 11。
        // 现状影响:building.zone 与首块表 zone 冲突,或楼栋已标 zone 但还没挂表时,催缴单的
        // splitShare 可能按错的/缺的期区分账(合计金额不受影响,只影响场地拆分呈现)。
        Map<Integer, String> zoneOfBuilding = new HashMap<>();
        for (Meter m : meters.selectList(null)) {
            meterById.put(m.getId(), m);
            if (m.getBuildingId() != null && m.getZone() != null)
                zoneOfBuilding.putIfAbsent(m.getBuildingId(), m.getZone());
        }
        Map<Integer, MeterReading> readingByMeter = readings.selectList(
                new QueryWrapper<MeterReading>().eq("ym", ym))
            .stream().collect(Collectors.toMap(MeterReading::getMeterId, r -> r));
        Map<Integer, Tenant> tenantById = tenants.selectList(null).stream()
            .collect(Collectors.toMap(Tenant::getId, t -> t));
        // 合同费项位置(premise):distinct location 原文,复用 locLabels 的「每 distinct location 一条」思路
        Map<Integer, List<String>> locsByContract = new HashMap<>();
        // 宿舍房间面积:dorm 计费行按 location 定位(430、431 多间合并行原样一间份,S4-3 拆行口径),面积取首个非空行
        Map<Integer, Map<String, BigDecimal>> dormRoomsByContract = new HashMap<>();
        Map<Integer, BigDecimal> rentAreaByContract = new HashMap<>();   // S5 分摊面积(建筑+公摊)按合同Σ
        // 计费行按合同归组(S5 §2 租金派生源;位置可空行也计费,故在 location 过滤之前收集)
        Map<Integer, List<ContractBillingTerm>> termsByContract = new HashMap<>();
        for (ContractBillingTerm t : billingTerms.selectList(new QueryWrapper<ContractBillingTerm>()
                .orderByAsc("contract_id", "seq", "id"))) {
            termsByContract.computeIfAbsent(t.getContractId(), k -> new ArrayList<>()).add(t);
            // S5 §1 分摊面积=Σ租金计费行(area+IFNULL(area_shared,0)),splitShare 拆分比例用(旧口径 rent_area 不含公摊)
            // S15 §4:宿舍行(AllocService.dormTerm)不入拆分比例——拆场地只用非宿舍面积,宿舍场地已有 dormRooms 专径
            if (ContractService.BUILDING_RENT_KEYS.contains(t.getFeeKey()) && t.getArea() != null
                    && !AllocService.dormTerm(t))
                rentAreaByContract.merge(t.getContractId(),
                    t.getArea().add(t.getAreaShared() == null ? BigDecimal.ZERO : t.getAreaShared()), BigDecimal::add);
            if (t.getLocation() == null || t.getLocation().isBlank()) continue;
            List<String> l = locsByContract.computeIfAbsent(t.getContractId(), k -> new ArrayList<>());
            String loc = t.getLocation().trim();
            if (!l.contains(loc)) l.add(loc);
            if ("dorm".equals(t.getPropertyType()) && t.getArea() != null && t.getArea().signum() > 0)
                dormRoomsByContract.computeIfAbsent(t.getContractId(), k -> new LinkedHashMap<>())
                    .putIfAbsent(loc, t.getArea());
        }
        // §2.5b 单元候选(S17):行级绑定 billing_term_unit → (单元结构化楼层, 单元号房号token, 行location)。
        // 「2F-2F整层」这类整层单元 floor=2 是结构化判据,不靠位置文本抠字;主/附加单元无行绑定的
        // 不入(location 归属不明,宁缺勿错)。供 pin() 房号零命中时的单元回退。
        Map<Integer, Unit> unitById = units.selectList(null).stream()
            .collect(Collectors.toMap(Unit::getId, u -> u));
        Map<Integer, ContractBillingTerm> termById = termsByContract.values().stream()
            .flatMap(List::stream).collect(Collectors.toMap(ContractBillingTerm::getId, t -> t));
        Map<Integer, List<UnitCand>> unitCandsByContract = new HashMap<>();
        for (BillingTermUnit b : termUnits.selectList(null)) {
            ContractBillingTerm t = termById.get(b.getTermId());
            Unit u = unitById.get(b.getUnitId());
            if (t == null || u == null || t.getLocation() == null || t.getLocation().isBlank()) continue;
            unitCandsByContract.computeIfAbsent(t.getContractId(), k -> new ArrayList<>())
                .add(new UnitCand(u.getFloor(), tok(u.getUnitNo()), t.getLocation().trim()));
        }

        // 当月在租合同(share 行按合同拆场地用;与容量费同一 covers 口径)
        List<Contract> allContracts = contracts.selectList(null);
        Map<Integer, List<Contract>> coveringByTenant = new HashMap<>();
        for (Contract c : allContracts)
            if (c.getTenantId() != null && MeterBindingService.covers(c, first, last))
                coveringByTenant.computeIfAbsent(c.getTenantId(), k -> new ArrayList<>()).add(c);
        Map<Integer, Map<String, Integer>> payByTenant = new HashMap<>();
        for (BillPayCompany p : payMap.selectList(null))
            payByTenant.computeIfAbsent(p.getTenantId(), k -> new HashMap<>()).put(p.getFeeKey(), p.getCompanyId());
        Map<Integer, AllocRule> ruleById = rules.selectList(null).stream()
            .collect(Collectors.toMap(AllocRule::getId, r -> r));

        Map<Integer, List<L>> byTenant = new LinkedHashMap<>();
        Map<Integer, Set<String>> warnByTenant = new HashMap<>();
        int[] seq = {0};

        // ── 逐租户表:判定树 B(表→合同归属=resolveBinding 行级快照) ──
        Map<Integer, List<Object[]>> metersByTenant = new LinkedHashMap<>();   // [Meter, Row]
        for (MeterBindingDTO.Row row : binding.resolveBinding(ym).rows()) {
            Meter m = meterById.get(row.meterId());
            if (m == null || m.getTenantId() == null) continue;   // pending/placeholder:无计费对象,不出行
            metersByTenant.computeIfAbsent(m.getTenantId(), k -> new ArrayList<>()).add(new Object[]{m, row});
        }
        for (Map.Entry<Integer, List<Object[]>> e : metersByTenant.entrySet()) {
            Integer tid = e.getKey();
            // 表序:sub_name(①②③ Unicode 序)优先,NULL 按 sort_no,id 顺位补号(仅展示,不回写)
            List<Object[]> ms = e.getValue().stream().sorted(Comparator
                .comparing((Object[] o) -> ((Meter) o[0]).getSubName() == null)
                .thenComparing(o -> ((Meter) o[0]).getSubName() == null ? "" : ((Meter) o[0]).getSubName())
                .thenComparing(o -> ((Meter) o[0]).getSortNo() == null ? 0 : ((Meter) o[0]).getSortNo())
                .thenComparing(o -> ((Meter) o[0]).getId())).toList();
            int nElec = 0, nWater = 0;
            for (Object[] o : ms) {
                Meter m = (Meter) o[0];
                MeterBindingDTO.Row row = (MeterBindingDTO.Row) o[1];
                String label = m.getSubName() != null ? m.getSubName()
                    : ("elec".equals(m.getKind()) ? "电表" + circled(++nElec) : "水表" + circled(++nWater));
                if ("manual".equals(row.status()))   // 无合同归属:降级挂租户出单+warn(§5.8)
                    warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>()).add("有表未归属合同");
                MeterReading r = readingByMeter.get(m.getId());
                if (r == null) continue;   // 缺抄不硬算(与池引擎同口径)
                // S6 §2.4:仅「真·零命中」按表记一条短警告(D3 借表/挂错合同,催缴单屏可见);
                // 无房号、候选无房号(整层/整栋计)、多命中都不是「未定」,不出噪音(判据见 Pin.undecided)
                if (pin(m, row.contractId(), locsByContract, unitCandsByContract).undecided())
                    warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>())
                        .add("场地未定:" + m.getName());
                if ("elec".equals(m.getKind()))
                    elecLines(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locsByContract, unitCandsByContract);
                else
                    waterLines(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locsByContract, unitCandsByContract);
            }
        }

        // ── 容量费:合同 kVA × capacity_fee;当月任一天在租(月区间重叠);起/止月落在 ym 内按天折;排除整租 ──
        for (Contract c : allContracts) {
            if ("master_lease".equals(c.getKind())) continue;   // 火炬园整租,防与散户双算(定案#4)
            if (c.getKva() == null || c.getKva().signum() <= 0) continue;
            if (!MeterBindingService.covers(c, first, last)) continue;   // 在租=非草稿+起止齐全+月区间重叠
            Integer tid = c.getTenantId();
            if (tid == null) continue;
            String zone = zoneOfBuilding.get(c.getBuildingId());
            PriceCfgService.PriceHit hit = price.resolveHit("capacity_fee", ym, tid, zone);
            if (hit == null) continue;
            // 按天折:闭区间在租天数/当月天数(起租月用起租日,退租月用止租日)
            LocalDate from = c.getStartDate().isAfter(first) ? c.getStartDate() : first;
            LocalDate to = c.getEndDate().isBefore(last) ? c.getEndDate() : last;
            long days = ChronoUnit.DAYS.between(from, to) + 1, total = last.getDayOfMonth();
            BigDecimal frac = days >= total ? BigDecimal.ONE
                : BigDecimal.valueOf(days).divide(BigDecimal.valueOf(total), 10, RoundingMode.HALF_UP);
            L l = base(byTenant, seq, tid, "capacity", hit, tenantOverride(hit, "fixed"));
            l.contractId = c.getId();
            l.premise = premiseOf(c.getId(), locsByContract);
            l.qty = c.getKva();
            l.amount = r2(c.getKva().multiply(hit.value()).multiply(frac));
            if (days < total) l.note = trunc("按天折:" + days + "/" + total + " 天", 255);
        }

        // ── 租金板块(S5 §2):逐 covering 合同逐计费行正式出单;按天折+免租期扣减 ──
        rentLines(byTenant, warnByTenant, seq, allContracts, termsByContract, first, last);

        // ── 公摊行:poolContributions 逐行落(池快照口径);损耗链行 ruleId=null → share_elec_loss ──
        for (AllocService.Contribution c : alloc.poolContributions(ym)) {
            if (c.tenantId() == null || c.amount() == null) continue;
            L l = new L();
            l.tenantId = c.tenantId(); l.seq = seq[0]++;
            l.qty = c.qty(); l.priceSnap = c.price(); l.amount = c.amount(); l.note = c.note();
            if (c.ruleId() == null) {   // p1/p2 损耗链(dorm 不进损耗组,宿舍段另算,见下);金额在户级收尾按链计(E2)
                l.feeKey = "share_elec_loss"; l.ruleBranch = "fixed"; l.rateTmp = c.rate();
                l.lossBuildings = c.lossBuildings(); l.chainName = c.lossChainName();
            } else {
                AllocRule rule = ruleById.get(c.ruleId());
                l.feeKey = c.feeKey(); l.ruleBranch = "pool"; l.poolRuleId = c.ruleId();
                // share_src:direct=member/area/floor 按池方法落;auto(园区级名册回退)Contribution 未携带,先按方法记
                l.shareSrc = rule == null ? null
                    : switch (rule.getMethod()) { case "direct" -> "member"; case "area" -> "area";
                                                  case "floor" -> "floor"; default -> null; };
                // base_snap=该户份额基数:area 池取 Contribution 携带的精确面积;其余反推=金额÷标准
                if (c.base() != null) l.baseSnap = c.base();
                else if (c.rate() != null && c.rate().signum() != 0)
                    l.baseSnap = c.amount().divide(c.rate(), 2, RoundingMode.HALF_UP);
                l.dorm = rule != null && "dorm".equals(rule.getZone());
                collectPrice(l, c, rule, ym);   // D① 月推类公摊池(路灯/绿化水)改收取价落行
                // S4-3 场地拆行:share 行按该户在租合同(宿舍逐房间)等比拆,Σ各场地行与租户级全等
                if (l.feeKey != null && l.feeKey.startsWith("share_")) {
                    for (L s : splitShare(l, rule, coveringByTenant, zoneOfBuilding,
                            locsByContract, dormRoomsByContract, rentAreaByContract, seq))
                        byTenant.computeIfAbsent(s.tenantId, k -> new ArrayList<>()).add(s);
                    continue;
                }
            }
            byTenant.computeIfAbsent(l.tenantId, k -> new ArrayList<>()).add(l);
        }

        // ── 孵化协议固定收取(包干):须在损耗收尾之前,包干额才进得了 E2 损耗基数 ──
        applyPackages(byTenant, warnByTenant, seq, ym, coveringByTenant, locsByContract, ruleById);

        // S13 §6:合同→楼栋(二期园区级公摊行/容量费行的损耗链归属按行合同楼栋判)
        Map<Integer, Integer> buildingOfContract = new HashMap<>();
        for (Contract c : allContracts)
            if (c.getBuildingId() != null) buildingOfContract.put(c.getId(), c.getBuildingId());

        // ── 户级收尾:p1/p2 损耗行金额口径分链计(E2,定案 2026-08-05)+按场地落行(S4-3) ──
        // 宿舍段损耗行已删(2024-02 通知单实证宿舍段无此行;spec §3⑦ loss_rate dorm=0.012 保留配置暂不消费)。
        for (Map.Entry<Integer, List<L>> e : byTenant.entrySet()) {
            List<L> ls = e.getValue();
            // E2 损耗行=金额口径分链计:amount=(链内户电费+链内公摊 floor/elevator/fire 行金额)×链损耗率;
            // 链=损耗组(head_building 分桶),多链户逐链(lossContributions 本就逐组产行)。
            // S4-3:链内行再按 premise 分组逐场地落行(链=楼栋↔场地):基数=该场地电费(不含容量)
            // +该场地楼层公共/电梯/消防公摊行金额;qty=该场地链内电行度数Σ(分时表=Σ段,E3 同口径)。
            // 基数不含容量费/管理费/宿舍段(dorm 行);链内判定=电表 building ∈ 链 / 公摊池 rule.building ∈ 链。
            List<L> lossSplit = new ArrayList<>();
            for (L l : ls) {
                if (l.rateTmp == null) continue;
                List<Integer> chain = l.lossBuildings == null ? List.of() : l.lossBuildings;
                // S13 §6 损耗base形态:户级flag(键带链作用域),无flag/未知值=B(现状)。A=另并链内 mgmt_fee 行;
                // C=仅户电费+容量费(星州);F=B去电梯再并 mgmt(邓宇峰×三车间链);G=B附加指定park表电费(永龙)。
                int form = lossBaseForm(ym, l.tenantId, chain);
                String formNote = formTag(form);   // null=形态B/未知值(容错按B),note 不加尾巴
                // 分桶键=wide(合同级粗粒度),不用细化后的 l.premise:两侧同桶才保住行数与逐行金额;
                // 损耗行自身 premise=桶键,故仍是 S6 前的值。
                Map<String, BigDecimal[]> byPremise = new LinkedHashMap<>();   // wide premise → {电费Σ,公摊Σ,度数Σ}
                Map<String, Integer> cidByPremise = new HashMap<>();
                for (L o : ls) {
                    if (o.amount == null) continue;
                    boolean inElec = false, inShare = false;
                    if (!o.dorm && "elec".equals(o.feeKey) && o.meterId != null) {
                        Meter m = meterById.get(o.meterId);
                        inElec = m != null && m.getBuildingId() != null && chain.contains(m.getBuildingId());
                    } else if (form != FORM_C && o.poolRuleId != null && ("share_elec_floor".equals(o.feeKey)
                            || (form != FORM_F && "share_elec_elevator".equals(o.feeKey))
                            || "share_elec_fire".equals(o.feeKey))) {
                        AllocRule pr = ruleById.get(o.poolRuleId);
                        // S13:二期园区级池(消防设施/稳压泵,楼栋空)在源册打包进户消防行 → base 也要吃;
                        // 链归属按行合同的楼栋判(splitShare 拆过的行才带 contractId,拆不出的照旧不进)
                        Integer cb = o.contractId == null ? null : buildingOfContract.get(o.contractId);
                        inShare = pr != null && (pr.getBuildingId() != null ? chain.contains(pr.getBuildingId())
                            : "p2".equals(pr.getZone()) && cb != null && chain.contains(cb));
                    } else if ((form == FORM_A || form == FORM_F || form == FORM_G) && !o.dorm
                            && "mgmt_fee".equals(o.feeKey) && o.meterId != null) {   // G 同源册:base 含管理费(永龙 K 列)
                        Meter m = meterById.get(o.meterId);   // 管理费逐表行,按表楼栋圈链
                        inShare = m != null && m.getBuildingId() != null && chain.contains(m.getBuildingId());
                    } else if (form == FORM_C && !o.dorm && "capacity".equals(o.feeKey) && o.contractId != null) {
                        Integer cb = buildingOfContract.get(o.contractId);   // 容量费无表,按合同楼栋圈链
                        inShare = cb != null && chain.contains(cb);
                    }
                    if (!inElec && !inShare) continue;
                    BigDecimal[] acc = byPremise.computeIfAbsent(wide(o),
                        k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
                    if (inElec) { acc[0] = acc[0].add(o.amount); if (o.qty != null) acc[2] = acc[2].add(o.qty); }
                    else acc[1] = acc[1].add(o.amount);
                    if (o.contractId != null) cidByPremise.putIfAbsent(wide(o), o.contractId);
                }
                // G:附加指定 park 表(S51反向有功)电费。金额优先取月度覆盖 loss_base_park_amount
                // (源册永龙 4 行反向按各段正价,单总读数推不出分段,逐月照抄册面金额),
                // 无覆盖回退 度数×p2平段价;其 0.16 管理费仍不收(用户搁置)。
                if (form == FORM_G) {
                    PriceCfgService.PriceHit amtHit = price.resolveHit("loss_base_park_amount", ym, l.tenantId, null);
                    BigDecimal add = amtHit != null && amtHit.scope().startsWith("tenant:") ? r2(amtHit.value()) : null;
                    if (add == null) {
                        PriceCfgService.PriceHit pmHit = price.resolveHit("loss_base_park_meter", ym, l.tenantId, null);
                        Meter pkm = pmHit == null || !pmHit.scope().startsWith("tenant:") ? null
                            : meterById.get(pmHit.value().intValue());
                        MeterReading pr = pkm == null ? null : readingByMeter.get(pkm.getId());
                        BigDecimal u = pr == null ? null
                            : MeterService.usage(pr.getPrevTotal(), pr.getCurrTotal(), pr.getFactorSnap());
                        BigDecimal fp = u == null || pkm.getBuildingId() == null || !chain.contains(pkm.getBuildingId())
                            ? null : price.resolve("elec_flat", ym, null, pkm.getZone());
                        if (u != null && fp != null) add = r2(u.multiply(fp));
                    }
                    if (add != null) {
                        // ponytail: G 全册唯一(永龙,单场地)——附加额并入首桶电费侧,出现多场地 G 户再分桶
                        BigDecimal[] acc = byPremise.isEmpty()
                            ? byPremise.computeIfAbsent(wide(l),
                                k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO})
                            : byPremise.values().iterator().next();
                        acc[0] = acc[0].add(add);
                    }
                }
                // 刀C 零基数残渣:链内一条 premise 空的零额行(拆不出场地的公摊行/未归属合同的零度表)
                // 会多开一个 chainBase=0 的桶,照桶补出一条 premise 空、金额 0.00 的损耗行。
                // 有非零桶时零桶一律丢弃(只丢 0.00 行,合计不动);全零或链内无行仍至少出一行,不吞损耗行。
                boolean anyBase = byPremise.values().stream().anyMatch(a -> a[0].add(a[1]).signum() != 0);
                if (anyBase) byPremise.values().removeIf(a -> a[0].add(a[1]).signum() == 0);
                if (byPremise.isEmpty())   // 链内无行:保留单行基数 0(原行为)
                    byPremise.put(wide(l), new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
                int i = 0;
                for (Map.Entry<String, BigDecimal[]> g : byPremise.entrySet()) {
                    L t;
                    if (i++ == 0) t = l;
                    else {
                        t = new L();
                        t.tenantId = l.tenantId; t.seq = seq[0]++;
                        t.feeKey = l.feeKey; t.ruleBranch = l.ruleBranch;
                        lossSplit.add(t);
                    }
                    BigDecimal[] a = g.getValue();
                    BigDecimal chainBase = a[0].add(a[1]);
                    t.premise = g.getKey(); t.contractId = cidByPremise.get(g.getKey());
                    t.baseSnap = chainBase; t.priceSnap = l.rateTmp;
                    t.qty = a[2].signum() == 0 ? null : a[2];
                    t.amount = r2(chainBase.multiply(l.rateTmp));
                    t.note = trunc("链[" + l.chainName + "]损耗=(场地电费 " + a[0] + "+公摊 " + a[1]
                        + ")×率 " + l.rateTmp + (formNote == null ? "" : ";base形态" + formNote), 255);
                }
            }
            ls.addAll(lossSplit);
        }

        // ── 拆单归集(§4):行→colId→bill_pay_company;宿舍段整段进 dorm 单收 dormRent 映射;offbook 户全单 offbook ──
        record NKey(Integer tenantId, Integer companyId, String kind) {}
        Map<NKey, List<L>> groups = new LinkedHashMap<>();
        int skippedIssued = 0, skippedConfirmed = 0;
        Set<Integer> seenSkipped = new LinkedHashSet<>();
        for (Map.Entry<Integer, List<L>> e : byTenant.entrySet()) {
            Integer tid = e.getKey();
            if (lockedTenants.contains(tid)) {
                if (seenSkipped.add(tid)) {
                    skippedIssued++;
                    if (confirmedTenants.contains(tid)) skippedConfirmed++;
                }
                continue;
            }
            Tenant t = tenantById.get(tid);
            boolean off = t != null && t.getOffbook() != null && t.getOffbook() == 1;
            for (L l : e.getValue()) {
                Map<String, Integer> pm = payByTenant.getOrDefault(tid, Map.of());
                Integer cid = null;
                if (l.dorm) cid = pm.get("dormRent");   // 宿舍收租方映射,无则走同类兜底
                if (cid == null) {
                    // rent 行(S5 §2):(property_type,fee_key)→colId 预算在 l.payCol;水电行沿 BillFeeMap.payCol
                    String col = l.payCol != null ? l.payCol : BillFeeMap.payCol(l.feeKey);
                    cid = col == null ? null : pm.get(col);
                    if (cid == null) {
                        String fb = BillFeeMap.fallbackCol(l.feeKey);
                        cid = fb == null ? null : pm.get(fb);
                    }
                }
                if (cid == null)
                    warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>()).add("有费项未设置收款公司");
                String kind = off ? "offbook" : (l.dorm ? "dorm" : "combined");
                groups.computeIfAbsent(new NKey(tid, cid, kind), k -> new ArrayList<>()).add(l);
            }
        }

        // ── 落库:行号=场地段(首现序)→表序→段序(构造序);单头 warn 拼接;负数合计打 warn ──
        // 单头仍逐条 insert(明细行要它回填的自增 id,350 次可接受);明细行先攒进 pending,
        // 循环结束后每 500 行一条多值 INSERT —— 逐条单发 8000 次在云上是 8~16s 且整段持锁独占两张表。
        // 事务不变(仍在同一 @Transactional 内全成全败),行的构造顺序与 line_no 也不变;
        // 唯一变的是行到达 DB 的时点后移,而本方法在 flush 之前不读回自己刚写的行(§5.9 回填在 flush 之后)。
        int generated = 0, warned = skippedIssued;
        List<BillNoticeLine> pending = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        for (Map.Entry<NKey, List<L>> g : groups.entrySet()) {
            List<L> ls = new ArrayList<>(g.getValue());
            Map<String, Integer> premiseOrder = new LinkedHashMap<>();
            for (L l : ls) if (l.premise != null) premiseOrder.putIfAbsent(l.premise, premiseOrder.size());
            ls.sort(Comparator
                .comparingInt((L l) -> l.premise == null ? Integer.MAX_VALUE : premiseOrder.get(l.premise))
                .thenComparingInt(l -> l.seq));
            BigDecimal total = ls.stream().map(l -> l.amount == null ? BigDecimal.ZERO : l.amount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
            Set<String> warns = new LinkedHashSet<>(
                warnByTenant.getOrDefault(g.getKey().tenantId(), Set.of()));
            if (total.signum() < 0) warns.add("本期合计为负");
            BillNotice n = new BillNotice();
            n.setYm(ym); n.setTenantId(g.getKey().tenantId()); n.setPayCompanyId(g.getKey().companyId());
            n.setNoticeKind(g.getKey().kind());
            // S6 §2.5:premise 变细后条目暴涨,255 硬截会切出半截房号(前端按「,」拆项会当成一个场地)→ 超 5 项收敛
            List<String> ps = new ArrayList<>(premiseOrder.keySet());
            n.setPremiseText(trunc(ps.size() <= 5 ? String.join(",", ps)
                : String.join(",", ps.subList(0, 5)) + ",等" + ps.size() + "处", 255));
            n.setTotalAmount(r2(total)); n.setPrevDue(BigDecimal.ZERO);   // prev_due 催缴闭环接口点,S4 留 0
            n.setStatus("draft");
            n.setWarn(warns.isEmpty() ? null : trunc(String.join(";", warns), 255));
            n.setGenBatch(batch); n.setGeneratedAt(now);
            notices.insert(n);
            if (n.getWarn() != null) warned++;
            int no = 0;
            for (L l : ls) {
                BillNoticeLine row = new BillNoticeLine();
                row.setNoticeId(n.getId()); row.setLineNo(++no);
                row.setFeeKey(l.feeKey); row.setPremise(l.premise);
                row.setMeterId(l.meterId); row.setMeterLabel(l.meterLabel); row.setContractId(l.contractId);
                row.setSeg(l.seg); row.setPrevRead(l.prevRead); row.setCurrRead(l.currRead);
                row.setFactorSnap(l.factorSnap); row.setQty(l.qty); row.setPriceSnap(l.priceSnap);
                row.setPriceKey(l.priceKey); row.setPriceScope(l.priceScope); row.setPriceMonth(l.priceMonth);
                row.setRuleBranch(l.ruleBranch); row.setPoolRuleId(l.poolRuleId);
                row.setShareSrc(l.shareSrc); row.setBaseSnap(l.baseSnap);
                row.setAmount(l.amount == null ? BigDecimal.ZERO : r2(l.amount));
                row.setNote(l.note);
                // fee_group(V90):rent 派生行显式 'rent'(S5 刀2);水电引擎行按 fee_key 归组,重生成不冲掉迁移回填
                row.setFeeGroup(l.feeGroup != null ? l.feeGroup
                    : WATER_GROUP.contains(l.feeKey) ? "water" : "elec");
                pending.add(row);
            }
            generated++;
        }
        int lineCount = pending.size();
        for (int i = 0; i < lineCount; i += 500)   // 分批:一条 SQL 太长会撞 max_allowed_packet
            noticeLines.insertBatch(pending.subList(i, Math.min(i + 500, lineCount)));

        // ── 回填:按 poolRuleId 聚合公摊行(含既有 issued 单的行,void 已清)→ alloc_pool_result 两列(§5.9) ──
        Map<Integer, BigDecimal> byRule = new HashMap<>();
        for (BillNoticeLine l : noticeLines.selectByYm(ym))
            if (l.getPoolRuleId() != null)
                byRule.merge(l.getPoolRuleId(), l.getAmount(), BigDecimal::add);
        for (AllocPoolResult s : poolResults.selectByYm(ym)) {
            BigDecimal allocated = r2(byRule.getOrDefault(s.getRuleId(), BigDecimal.ZERO));
            s.setAllocatedAmount(allocated);
            s.setGapAmount(s.getCostAmount() == null ? null : allocated.subtract(s.getCostAmount()));
            poolResults.updateById(s);
        }
        return new BillNoticeGenResultDTO(generated, lineCount, warned, skippedConfirmed, batch);
    }

    // ── 电表判定树B:elec_package 户级命中→包干单行 / 分时(curr_peak|flat|valley 任一非空)→四段+mgmt0.16
    //    / is_dorm_room→居民+mgmt0.16 / 商业+mgmt0.32;户级例外由 resolveHit 的 scope 链天然覆盖 ──
    private void elecLines(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                           String ym, Integer tid, Meter m, MeterBindingDTO.Row row, MeterReading r,
                           String label, Map<Integer, List<String>> locs,
                           Map<Integer, List<UnitCand>> unitCands) {
        boolean dormRoom = m.getIsDormRoom() != null && m.getIsDormRoom() == 1;
        String zone = dormRoom ? "dorm" : m.getZone();
        BigDecimal f = r.getFactorSnap();
        BigDecimal total = MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), f);
        // 包干:户级键命中(scope=tenant:)⇒全部用量×包干价单行,不出 mgmt 行(§5 要点)
        PriceCfgService.PriceHit pkg = price.resolveHit("elec_package", ym, tid, zone);
        if (pkg != null && pkg.scope().startsWith("tenant:")) {
            if (total == null) return;
            L l = meterLine(byTenant, seq, tid, m, row, label, locs, unitCands, dormRoom, "elec", "elec_package", null,
                r.getPrevTotal(), r.getCurrTotal(), f, total, pkg, "tenant_override");
            l.amount = r2(total.multiply(pkg.value()));
            return;
        }
        boolean tou = r.getCurrPeak() != null || r.getCurrFlat() != null || r.getCurrValley() != null;
        String mgmtKey;
        BigDecimal segSum = null;   // E3:分时表管理费基数=Σ段用量(源册口径,常与总示数差分位);段全缺回退总示数
        if (tou) {
            mgmtKey = "mgmt_fee";
            for (String seg : SEGS) {
                BigDecimal prev = segPrev(r, seg), curr = segCurr(r, seg);
                BigDecimal u = MeterService.usage(prev, curr, f);
                if (u == null) continue;
                segSum = segSum == null ? u : segSum.add(u);
                PriceCfgService.PriceHit hit;
                BigDecimal p;
                String note = null;
                if ("sharp".equals(seg)) {   // 尖段实收=尖×r+峰×(1−r);r=sharp_as_peak_ratio(0⇒实收峰价);price_snap 存实收价
                    PriceCfgService.PriceHit sh = price.resolveHit("elec_sharp", ym, tid, zone);
                    PriceCfgService.PriceHit pk = price.resolveHit("elec_peak", ym, tid, zone);
                    if (sh == null && pk == null) { missPrice(warnByTenant, tid, "elec_sharp", ym); continue; }
                    BigDecimal ratio = nz(price.resolve("sharp_as_peak_ratio", ym, tid, zone));
                    hit = sh != null ? sh : pk;
                    p = sh == null ? pk.value() : pk == null ? sh.value()
                        : ratio.multiply(sh.value()).add(BigDecimal.ONE.subtract(ratio).multiply(pk.value()));
                    note = "尖按峰比率r=" + ratio;
                } else {
                    hit = price.resolveHit("elec_" + seg, ym, tid, zone);
                    if (hit == null) { missPrice(warnByTenant, tid, "elec_" + seg, ym); continue; }
                    p = hit.value();
                }
                L l = meterLine(byTenant, seq, tid, m, row, label, locs, unitCands, dormRoom, "elec",
                    "elec_" + seg, seg, prev, curr, f, u, hit, tenantOverride(hit, "tou"));
                l.priceSnap = p;
                l.amount = r2(u.multiply(p));
                l.note = note;
            }
        } else if (dormRoom) {
            mgmtKey = "mgmt_fee";
            singlePrice(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locs, unitCands, true,
                "elec", "elec_resident", zone, total, "resident");
        } else {
            mgmtKey = "mgmt_fee_commercial";
            singlePrice(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locs, unitCands, false,
                "elec", "elec_commercial", zone, total, "commercial");
        }
        // 电力管理费:基数×费率;分时表基数=Σ段用量(E3),否则总用量;费率查无或为 0 不出行(§5 要点);逐表落行保 meter 关联
        BigDecimal mgmtBase = segSum != null ? segSum : total;
        if (mgmtBase == null) return;
        PriceCfgService.PriceHit mg = price.resolveHit(mgmtKey, ym, tid, zone);
        if (mg == null || mg.value().signum() == 0) return;
        L l = meterLine(byTenant, seq, tid, m, row, label, locs, unitCands, dormRoom, "mgmt_fee", mgmtKey, null,
            null, null, f, mgmtBase, mg, tenantOverride(mg, "fixed"));
        l.amount = r2(mgmtBase.multiply(mg.value()));
        if (total != null && segSum != null && segSum.compareTo(total) != 0)
            l.note = trunc("管理费基数=Σ段 " + segSum + "(总示数 " + total + ")", 255);
    }

    // ── 水表:is_dorm_room→3.85+管网0(dorm scope 天然给 0=不出行)/否则 3.95+0.5;户级例外同链 ──
    private void waterLines(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                            String ym, Integer tid, Meter m, MeterBindingDTO.Row row, MeterReading r,
                            String label, Map<Integer, List<String>> locs,
                            Map<Integer, List<UnitCand>> unitCands) {
        boolean dormRoom = m.getIsDormRoom() != null && m.getIsDormRoom() == 1;
        String zone = dormRoom ? "dorm" : m.getZone();
        BigDecimal total = MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
        if (total == null) return;
        singlePrice(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locs, unitCands, dormRoom,
            "water", "water", zone, total, dormRoom ? "resident" : "commercial");
        PriceCfgService.PriceHit pipe = price.resolveHit("water_pipe", ym, tid, zone);
        if (pipe == null || pipe.value().signum() == 0) return;
        L l = meterLine(byTenant, seq, tid, m, row, label, locs, unitCands, dormRoom, "water_pipe", "water_pipe", null,
            null, null, r.getFactorSnap(), total, pipe, tenantOverride(pipe, "fixed"));
        l.amount = r2(total.multiply(pipe.value()));
    }

    // 单一价行(电居民/电商业/水)
    private void singlePrice(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                             String ym, Integer tid, Meter m, MeterBindingDTO.Row row, MeterReading r,
                             String label, Map<Integer, List<String>> locs,
                             Map<Integer, List<UnitCand>> unitCands, boolean dormRoom,
                             String feeKey, String priceKey, String zone, BigDecimal total, String branch) {
        if (total == null) return;
        PriceCfgService.PriceHit hit = price.resolveHit(priceKey, ym, tid, zone);
        if (hit == null) { missPrice(warnByTenant, tid, priceKey, ym); return; }
        L l = meterLine(byTenant, seq, tid, m, row, label, locs, unitCands, dormRoom, feeKey, priceKey, null,
            r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap(), total, hit, tenantOverride(hit, branch));
        l.amount = r2(total.multiply(hit.value()));
    }

    // 表行公共骨架(审计链 price_key/scope/month + 合同快照 + 场地段)
    private L meterLine(Map<Integer, List<L>> byTenant, int[] seq, Integer tid, Meter m,
                        MeterBindingDTO.Row row, String label, Map<Integer, List<String>> locs,
                        Map<Integer, List<UnitCand>> unitCands, boolean dorm,
                        String feeKey, String cfgKey, String seg, BigDecimal prev, BigDecimal curr, BigDecimal f,
                        BigDecimal qty, PriceCfgService.PriceHit hit, String branch) {
        L l = new L();
        l.tenantId = tid; l.seq = seq[0]++; l.dorm = dorm;
        l.feeKey = feeKey; l.seg = seg;
        l.meterId = m.getId(); l.meterLabel = label;
        l.contractId = row.contractId();
        l.premise = resolveMeterPremise(m, row.contractId(), locs, unitCands);   // S6 §2.2 表行场地跟表走,不跟合同走
        l.premiseWide = premiseOf(row.contractId(), locs);            // 损耗分桶键=S6 前的合同级值(见 L.premiseWide)
        l.prevRead = prev; l.currRead = curr; l.factorSnap = f; l.qty = qty;
        l.priceSnap = hit.value(); l.priceKey = cfgKey;
        l.priceScope = hit.scope(); l.priceMonth = hit.acctMonth();
        l.ruleBranch = branch;
        byTenant.computeIfAbsent(tid, k -> new ArrayList<>()).add(l);
        return l;
    }

    // 容量费行骨架(无表)
    private L base(Map<Integer, List<L>> byTenant, int[] seq, Integer tid, String feeKey,
                   PriceCfgService.PriceHit hit, String branch) {
        L l = new L();
        l.tenantId = tid; l.seq = seq[0]++;
        l.feeKey = feeKey;
        l.priceSnap = hit.value(); l.priceKey = "capacity_fee";
        l.priceScope = hit.scope(); l.priceMonth = hit.acctMonth();
        l.ruleBranch = branch;
        byTenant.computeIfAbsent(tid, k -> new ArrayList<>()).add(l);
        return l;
    }

    // ── S5 §2 租金派生:逐 covering 合同(排 master_lease/draft)逐计费行一条明细 ──
    // 缺起止日期→整户 warn「缺起止日期,租金未派生」不出行(157 户清单已交用户补日期);
    // 金额=lineMonthly×按天折,rent_* 再减免租期扣减;premise=行 location;fee_group='rent'。
    private void rentLines(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                           List<Contract> allContracts, Map<Integer, List<ContractBillingTerm>> termsByContract,
                           LocalDate first, LocalDate last) {
        for (Contract c : allContracts) {
            if ("master_lease".equals(c.getKind()) || "draft".equals(c.getStatus())) continue;
            Integer tid = c.getTenantId();
            if (tid == null) continue;
            if (c.getStartDate() == null || c.getEndDate() == null) {
                warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>()).add("缺起止日期,租金未派生");
                continue;
            }
            if (!MeterBindingService.covers(c, first, last)) continue;
            BigDecimal ratio = prorate(c, first, last);
            // 折算式素材(非整月 note 用):在租天数/当月天数
            LocalDate rentFrom = c.getStartDate().isAfter(first) ? c.getStartDate() : first;
            LocalDate rentTo = c.getEndDate().isBefore(last) ? c.getEndDate() : last;
            long days = ChronoUnit.DAYS.between(rentFrom, rentTo) + 1;
            int len = first.lengthOfMonth();
            for (ContractBillingTerm t : termsByContract.getOrDefault(c.getId(), List.of())) {
                BigDecimal monthly = ContractService.lineMonthly(t, c.getKva());
                if (monthly == null) {   // 缺参数=待录,跳行并 warn
                    warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>()).add("计费行缺参数,租金行未派生");
                    continue;
                }
                BigDecimal amt = r2(monthly.multiply(ratio));
                String note = ratio.compareTo(BigDecimal.ONE) < 0
                    ? monthly.stripTrailingZeros().toPlainString() + "÷" + len + "×" + days : null;
                if (t.getFeeKey() != null && t.getFeeKey().startsWith("rent_")) {
                    // 免租期仅扣 rent_* 费项(管理费/基础设施费照收,园区惯例)
                    BigDecimal cut = rentFreeCut(c, monthly, rentFrom, rentTo, first, warnByTenant);
                    if (cut.signum() > 0) {
                        amt = r2(amt.subtract(cut));
                        note = (note == null ? "" : note + ";") + "免租扣" + cut.toPlainString();
                    }
                }
                L l = new L();
                l.tenantId = tid; l.seq = seq[0]++;
                l.dorm = "dorm".equals(t.getPropertyType());   // 宿舍段随 dorm 单(收 dormRent 映射)
                l.feeKey = t.getFeeKey(); l.feeGroup = "rent"; l.ruleBranch = "rent";
                l.contractId = c.getId();
                l.premise = t.getLocation() == null || t.getLocation().isBlank()
                    ? null : trunc(t.getLocation().trim(), 64);
                l.payCol = BillFeeMap.rentPayCol(t.getPropertyType(), t.getFeeKey());
                if ("per_sqm_month".equals(t.getBillMode())) {
                    // 面积拆解上屏(S5 §2):qty=建筑面积,base_snap=公摊面积(空=area 已含公摊),price_snap=单价
                    l.qty = t.getArea(); l.priceSnap = t.getUnitPrice(); l.baseSnap = t.getAreaShared();
                }
                l.amount = amt; l.note = trunc(note, 255);
                byTenant.computeIfAbsent(tid, k -> new ArrayList<>()).add(l);
            }
        }
    }

    // 在租天数/当月天数;整月=1(不出折算 note)
    private static BigDecimal prorate(Contract c, LocalDate first, LocalDate last) {
        LocalDate s = c.getStartDate().isAfter(first) ? c.getStartDate() : first;
        LocalDate e = c.getEndDate().isBefore(last) ? c.getEndDate() : last;
        long days = ChronoUnit.DAYS.between(s, e) + 1;
        int len = first.lengthOfMonth();
        return days >= len ? BigDecimal.ONE
            : new BigDecimal(days).divide(new BigDecimal(len), 8, RoundingMode.HALF_UP);
    }

    // 免租期扣减(S5 §2):rent_free JSON 数组 [{start,end}] 与本月在租区间相交天数按天折,
    // Σ相交天数/lengthOfMonth×monthly,r2;解析失败=0 并入 warn(写入口 validateRentFree 已校验,防御历史脏数据)
    private static BigDecimal rentFreeCut(Contract c, BigDecimal monthly, LocalDate rentFrom, LocalDate rentTo,
                                          LocalDate first, Map<Integer, Set<String>> warnByTenant) {
        String rf = c.getRentFree();
        if (rf == null || rf.isBlank()) return BigDecimal.ZERO;
        long freeDays = 0;
        try {
            JsonNode arr = JSON.readTree(rf);
            if (!arr.isArray()) throw new IllegalArgumentException("非数组");
            for (JsonNode seg : arr) {
                LocalDate s = LocalDate.parse(seg.get("start").asText());
                LocalDate e = LocalDate.parse(seg.get("end").asText());
                // 与本月在租区间相交(免租只能扣在租天数,天然不出负额)
                LocalDate from = s.isAfter(rentFrom) ? s : rentFrom;
                LocalDate to = e.isBefore(rentTo) ? e : rentTo;
                if (!from.isAfter(to)) freeDays += ChronoUnit.DAYS.between(from, to) + 1;
            }
        } catch (Exception ex) {
            warnByTenant.computeIfAbsent(c.getTenantId(), k -> new LinkedHashSet<>()).add("免租期解析失败,未扣减");
            return BigDecimal.ZERO;
        }
        if (freeDays == 0) return BigDecimal.ZERO;
        return monthly.multiply(new BigDecimal(freeDays))
            .divide(new BigDecimal(first.lengthOfMonth()), 2, RoundingMode.HALF_UP);
    }

    // D① 收取价(调查 2026-08-05 钉死;SQL 落点 scripts/fixes/share-charge-rate-20260805.sql):
    // 月推类公摊池(路灯 share_elec_light/绿化水 share_green_water)落行=收取单价×户面积,price_snap 存收取价,
    // note 保留核算率备查。分流:p1/dorm 收取价=当月池核算率(std_value,当月核算再舍入,Excel VLOOKUP 同口径);
    // p2 默认取冻结常数(tenant_price_cfg p2.lamp_rate=0.005/p2.green_rate=0.01,=隐藏死模板 公共电分摊!M99/M109),
    // 户级 live 例外(tenant:{id}.lamp_rate_live/green_rate_live=1,sheet 引用 公共电数据!V95/V65 的 16 户)
    // 改取当月核算率(std 已含 fold_add,如绿化 V65=0.001+V77 水泵折入 0.007)。
    private void collectPrice(L l, AllocService.Contribution c, AllocRule rule, String ym) {
        boolean lampFee = "share_elec_light".equals(c.feeKey());
        if (!(lampFee || "share_green_water".equals(c.feeKey()))) return;
        // p2 池路径的 Contribution 不带面积,行上 baseSnap=金额÷标准 回推即面积(保奔路 12.80÷0.008=1600)
        BigDecimal base = c.base() != null ? c.base() : l.baseSnap;
        if (base == null) return;
        BigDecimal collect = c.rate();   // 默认:收取价=当月池核算率(std,分量各自ROUND再相加)
        if (rule != null && "p2".equals(rule.getZone())) {
            // S13 §9 翻转:p2 默认改当月核算率(绿化 V65=水泵0.001+装饰灯折入0.007=0.008,路灯 V95=0.005),
            // 户级 tenant:{id}.{key} 显式收取价=例外(0.01 组≈37 户,=死模板 公共电分摊!M109 沿用户)。
            // 旧机制退役:冻结常数 p2.{key} 与 tenant:{id}.{key}_live 不再参与分流,行留档备查。
            String key = lampFee ? "lamp_rate" : "green_rate";
            PriceCfgService.PriceHit hit = price.resolveHit(key, ym, l.tenantId, "p2");
            if (hit != null && hit.scope().startsWith("tenant:")) {
                collect = hit.value();
                l.priceKey = key; l.priceScope = hit.scope(); l.priceMonth = hit.acctMonth();
                l.note = trunc("收取价例外;核算率 " + (c.rate() == null ? "-" : c.rate().stripTrailingZeros().toPlainString()) + " 备查", 255);
            } else {
                l.note = trunc("收取价=当月核算率", 255);
            }
        }
        if (collect == null) return;
        l.priceSnap = collect;
        l.amount = r2(collect.multiply(base));
    }

    // ── 孵化协议固定收取(包干):户级 share_elec_fixed / share_water_fixed 命中 → 原公摊行整户不落,
    //    改落一条固定额行。取证=源册 一期2024年2月水电费.xlsx:
    //    ① 纸单一项一行「公共用电分摊 xx元/月」,同户「楼层公共、消防照明 / 电梯用电 / 路灯公摊」三项全无;
    //       「2024年2月电费总表」同步 I(消防用电)=包干额、J(电梯)=0、K(路灯)=0 —— 包干是替换不是附加。
    //    ② 同一纸单第二个包干「公共用水分摊 xx元/月」记在「用水维护费」块;「2024年2月水费总表」
    //       G(绿化水公摊)=包干额、F(用水维护费)=0。⚠ 水管网维护费(吨×0.5)不在吞掉之列:五户纸单上它
    //       仍是活公式(联塑精铟 I12=I11、优唯特 H14=0.5、重瞳 J14=0.5),当月为 0 只因户内用水量为 0。
    //    ③ 宿舍段照收(联塑精铟 K18 宿舍路灯 4.47 / K26 宿舍绿化水 1.49)→ dorm 行不吞。
    //    fee_key 沿用 share_elec_floor / share_green_water:BillFeeMap 收款映射不动,且 E2 损耗基数
    //    白名单(floor|elevator|fire)自动把电包干额算进去 —— 联塑精铟 (43.8+232)×0.0616=16.99 与源册 K7 全等。
    //    池锚点:电侧=该户显式勾选的 share_elec_floor 池中 sort_no 最小者(联塑精铟挂的 rule 92 是 manual
    //    无表池,自己不产贡献行,只有查受益人名册才找得到);水侧=被吞掉那条绿化水行的原池(园区级自动
    //    名册池没有显式成员)。回挂后 §5.9 按 pool_rule_id 回填 allocated/gap,复刻源册 AE/AF 两列。
    private void applyPackages(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                               String ym, Map<Integer, List<Contract>> covering,
                               Map<Integer, List<String>> locs, Map<Integer, AllocRule> ruleById) {
        Map<Integer, Integer> floorAnchor = new HashMap<>();
        // 受益人=版本组前滚(S14):逐规则走 AllocService.pickMembers 同源解析,与引擎当月受益人口径一致
        Map<Integer, List<AllocRuleMember>> memRows = ruleMembers.selectList(null).stream()
            .collect(Collectors.groupingBy(AllocRuleMember::getRuleId));
        for (List<AllocRuleMember> rows : memRows.values())
            for (AllocRuleMember m : AllocService.pickMembers(rows, ym)) {
                AllocRule r = ruleById.get(m.getRuleId());
                if (r == null || !"share_elec_floor".equals(r.getFeeKey())) continue;
                floorAnchor.merge(m.getTenantId(), r.getId(),
                    (a, b) -> sortNo(ruleById.get(a)) <= sortNo(ruleById.get(b)) ? a : b);
            }
        for (Integer tid : covering.keySet()) {   // 当月无在租合同=不落包干行(跟源册走)
            packageLine(byTenant, warnByTenant, seq, ym, tid, "share_elec_fixed", "share_elec_floor",
                PKG_ELEC_SWALLOW, floorAnchor.get(tid), covering, locs, "孵化协议固定收取");
            packageLine(byTenant, warnByTenant, seq, ym, tid, "share_water_fixed", "share_green_water",
                PKG_WATER_SWALLOW, null, covering, locs, "孵化协议固定收取");
            // S13 拍板③:曹小芳/刘彪消防照抄源册实收(I=ROUND(公共电分摊!L24+L99×面积/层份,2)×层份,
            // 合成价≈250,全册仅此两户)——该户全部 share_elec_fire 行(车间池+园区消防设施+稳压泵)
            // 整组替换为一条固定额行;层份 weight 仍在册供 Σweight 对账。走 applyPackages 同一时点,
            // 天然在 E2 之前:两户损耗 base 的消防分量=实收合成额(源册 K42 同口径)。
            packageLine(byTenant, warnByTenant, seq, ym, tid, "fire_amount_fixed", "share_elec_fire",
                Set.of("share_elec_fire"), null, covering, locs, "消防照抄源册实收(L24+L99合成价;S13拍板③户级例外)");
        }
    }

    private static int sortNo(AllocRule r) {
        return r == null || r.getSortNo() == null ? Integer.MAX_VALUE : r.getSortNo();
    }

    private void packageLine(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                             String ym, Integer tid, String cfgKey, String feeKey, Set<String> swallow,
                             Integer anchor, Map<Integer, List<Contract>> covering,
                             Map<Integer, List<String>> locs, String note) {
        PriceCfgService.PriceHit hit = price.resolveHit(cfgKey, ym, tid, null);
        if (hit == null || !hit.scope().startsWith("tenant:")) return;   // 只认户级配置
        List<L> ls = byTenant.computeIfAbsent(tid, k -> new ArrayList<>());
        String premise = null;
        Integer contractId = null, poolId = anchor;
        for (Iterator<L> it = ls.iterator(); it.hasNext(); ) {
            L o = it.next();
            if (o.dorm || o.poolRuleId == null || !swallow.contains(o.feeKey)) continue;
            if (premise == null && o.premise != null) { premise = o.premise; contractId = o.contractId; }
            if (poolId == null && feeKey.equals(o.feeKey)) poolId = o.poolRuleId;
            it.remove();
        }
        // 固定 0=免收:吞掉原公摊行、不落新行(S13 陈书谨钢构——源册无消防行,园区面积项也不收)。
        if (hit.value().signum() == 0) return;
        // 被吞的行都没落上场地(池楼栋≠合同楼栋时 splitShare 拆不出)→ 回退合同级:
        // 与该户表行同一个损耗分桶键,否则 E2 会为包干额单开一桶多出一条损耗行。
        if (premise == null)
            for (Contract c : covering.getOrDefault(tid, List.of())) {
                String p = premiseOf(c.getId(), locs);
                if (p != null) { premise = p; contractId = c.getId(); break; }
            }
        L l = new L();
        l.tenantId = tid; l.seq = seq[0]++;
        l.feeKey = feeKey; l.premise = premise; l.contractId = contractId;
        l.ruleBranch = "fixed"; l.poolRuleId = poolId;
        l.priceKey = cfgKey; l.priceScope = hit.scope(); l.priceMonth = hit.acctMonth();
        l.priceSnap = hit.value(); l.amount = r2(hit.value());
        l.note = note;
        ls.add(l);
        if (poolId == null)
            warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>()).add("包干行无公摊池锚点");
    }

    // ── S4-3 场地拆行(share_* 公摊行):租户级一行 → 按该户在租合同(宿舍逐房间)等比拆 ──
    // premise=该合同 location 主文本(宿舍=该 dorm 计费行 location);base_snap=该合同份额基数(面积);
    // 金额/数量/基数按份额等比、末行取余:Σ各场地行与原租户级行全等,拆分只重分布不改总额。
    // 候选:池带楼栋(电梯/楼层公共)→ 只挂该栋合同;园区级池 → 该 zone 全部在租合同;
    // 宿舍池 → 各合同 dorm 计费行逐 location(430、431 多间合并行原样一行,定位不到的不硬拆)。
    // 候选为空/基数Σ为 0 → 原行原样保留(premise 空,如可莱恩 C402 无合同归属待拍板)。
    private List<L> splitShare(L l, AllocRule rule, Map<Integer, List<Contract>> covering,
                               Map<Integer, String> zoneOfBuilding, Map<Integer, List<String>> locs,
                               Map<Integer, Map<String, BigDecimal>> dormRooms,
                               Map<Integer, BigDecimal> rentAreaByContract, int[] seq) {
        List<Object[]> parts = new ArrayList<>();   // {premise, contractId, base}
        for (Contract c : covering.getOrDefault(l.tenantId, List.of())) {
            if (l.dorm) {
                for (Map.Entry<String, BigDecimal> room : dormRooms.getOrDefault(c.getId(), Map.of()).entrySet())
                    parts.add(new Object[]{room.getKey(), c.getId(), room.getValue()});
            } else {
                if (rule == null || c.getBuildingId() == null) continue;
                // S5:拆分比例=Σ租金计费行(建筑+公摊),无计费行回退 rent_area(可莱恩 79.44/162 按 1986/4050 拆)
                BigDecimal ra = rentAreaByContract.getOrDefault(c.getId(), c.getRentArea());
                if (ra == null || ra.signum() <= 0) continue;
                boolean in = rule.getBuildingId() != null ? rule.getBuildingId().equals(c.getBuildingId())
                    : rule.getZone() != null && rule.getZone().equals(zoneOfBuilding.get(c.getBuildingId()));
                if (in) parts.add(new Object[]{premiseOf(c.getId(), locs), c.getId(), ra});
            }
        }
        BigDecimal baseSum = parts.stream().map(p -> (BigDecimal) p[2]).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (parts.isEmpty() || baseSum.signum() == 0) return List.of(l);
        List<L> out = new ArrayList<>();
        // ⚠i=0 复用 l 对象且就地覆写 amount/qty/baseSnap——比例算式必须用循环前快照的原值,
        //   否则第 2 行起按已缩小的首行金额等比(≥3 场地时中间行全错、末行余额虚胖,宿舍六间实锚)
        BigDecimal amt0 = l.amount, qty0 = l.qty, base0 = l.baseSnap;
        BigDecimal amtLeft = l.amount, qtyLeft = l.qty, baseLeft = l.baseSnap;
        for (int i = 0; i < parts.size(); i++) {
            L s;
            if (i == 0) s = l;
            else {
                s = new L();
                s.tenantId = l.tenantId; s.dorm = l.dorm; s.seq = seq[0]++;
                s.feeKey = l.feeKey; s.priceKey = l.priceKey; s.priceScope = l.priceScope;
                s.priceMonth = l.priceMonth; s.ruleBranch = l.ruleBranch; s.shareSrc = l.shareSrc;
                s.poolRuleId = l.poolRuleId; s.priceSnap = l.priceSnap; s.note = l.note;
            }
            s.premise = trunc((String) parts.get(i)[0], 64);
            s.contractId = (Integer) parts.get(i)[1];
            BigDecimal share = (BigDecimal) parts.get(i)[2];
            boolean last = i == parts.size() - 1;
            s.amount = last ? amtLeft : prorate(amt0, share, baseSum);
            s.qty = last ? qtyLeft : prorate(qty0, share, baseSum);
            s.baseSnap = last ? baseLeft : prorate(base0, share, baseSum);
            if (!last) {
                amtLeft = minus(amtLeft, s.amount);
                qtyLeft = minus(qtyLeft, s.qty);
                baseLeft = minus(baseLeft, s.baseSnap);
            }
            out.add(s);
        }
        return out;
    }

    private static BigDecimal prorate(BigDecimal total, BigDecimal share, BigDecimal baseSum) {
        return total == null ? null : r2(total.multiply(share).divide(baseSum, 10, RoundingMode.HALF_UP));
    }
    private static BigDecimal minus(BigDecimal a, BigDecimal b) {
        return a == null ? null : a.subtract(nz(b));
    }

    private static String tenantOverride(PriceCfgService.PriceHit hit, String base) {
        return hit.scope().startsWith("tenant:") ? "tenant_override" : base;
    }

    private static void missPrice(Map<Integer, Set<String>> warnByTenant, Integer tid, String key, String ym) {
        warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>()).add("缺价 " + key + "(" + ym + ")");
    }

    // ── S13 §6 损耗base形态flag(tenant_price_cfg,不进价目白名单,SQL 直落;resolveHit 只认 tenant: 作用域):
    //    值 1=A(B+管理费)/3=C(仅户电费+容量费)/6=F(B去电梯+管理费)/7=G(B+park表电费);缺省或未知值=B(现状)。
    //    键带损耗链作用域:loss_base_form_b{楼栋id}(链内任一成员楼栋,邓宇峰三车间链≠六车间链靠它分)
    //    优先,回退 loss_base_form(整户);G 另配 loss_base_park_meter=park表id(S51反向有功)。 ──
    private static final int FORM_A = 1, FORM_B = 2, FORM_C = 3, FORM_F = 6, FORM_G = 7;

    private int lossBaseForm(String ym, Integer tid, List<Integer> chain) {
        for (Integer bid : chain) {
            PriceCfgService.PriceHit h = price.resolveHit("loss_base_form_b" + bid, ym, tid, null);
            if (h != null && h.scope().startsWith("tenant:")) return h.value().intValue();
        }
        PriceCfgService.PriceHit h = price.resolveHit("loss_base_form", ym, tid, null);
        return h != null && h.scope().startsWith("tenant:") ? h.value().intValue() : FORM_B;
    }

    private static String formTag(int form) {
        return switch (form) {
            case FORM_A -> "A(含管理费)"; case FORM_C -> "C(户电费+容量费)";
            case FORM_F -> "F(不含电梯,含管理费)"; case FORM_G -> "G(附加park表电费)";
            default -> null;
        };
    }

    // 损耗分桶键:表行取 S6 前的合同级值,其余行(公摊/租金/容量)premise 本就是合同级
    private static String wide(L l) { return l.premiseWide != null ? l.premiseWide : l.premise; }

    private static String premiseOf(Integer contractId, Map<Integer, List<String>> locs) {
        if (contractId == null) return null;
        List<String> l = locs.get(contractId);
        return l == null || l.isEmpty() ? null : trunc(String.join("、", l), 64);
    }

    // ══════════ S6 §2 场地标签按表定位(表行 premise 跟表走,不跟合同走) ══════════

    // §2.1 房号 token=最长连续数字段中 3~4 位者。整段判长度,12 位 code 直接落选(不切子串);
    //      「309.00」→{309}、「1-309」→{309}、「501-504」→{501,504}、「11号楼」的 11 不入。
    static Set<String> tok(String s) {
        if (s == null) return Set.of();
        Set<String> out = new LinkedHashSet<>();
        var m = DIGITS.matcher(s);
        while (m.find()) if (m.end() - m.start() >= 3 && m.end() - m.start() <= 4) out.add(m.group());
        return out;
    }

    // §2.1 name/room_no 权威(锚:表 929 name=411.00 而 spot=五楼 1-516),抽不出才回落 spot/sub_name。
    static Set<String> roomTokens(Meter m) {
        Set<String> out = new LinkedHashSet<>(tok(m.getRoomNo()));
        out.addAll(tok(m.getName()));
        if (!out.isEmpty()) return out;
        out.addAll(tok(m.getSpot()));
        out.addAll(tok(m.getSubName()));
        return out;
    }

    // §2.2 定位结果:text=命中的那条计费行 location(必要时按房号合成单间),未命中=null;
    // tokens=表侧抽出的房号数、cands=该合同候选计费行数、candTokens=候选侧抽出的房号数、
    // hits=候选中被命中的条数——后四项是 §2.4 告警的判据
    // (调用方必须能分开「无房号」「候选无房号」「多命中」「真·零命中」四种 null)。
    record Pin(String text, int tokens, int cands, int candTokens, int hits) {
        // §2.4「真·零命中」=表有房号、合同候选行也有房号,却一条都对不上(D3 借表/挂错合同,人工归属可消)。
        // 无房号(开利暖通整栋表、翔海借电)无场地可定,告警永远消不掉=噪音;
        // 多命中(桑尼号「二楼201、301室」)与 §2.2 |inter|>1「取原文=已定场地」同构,更不是未定;
        // 候选无房号(金纳「一期D座三楼整层」按整层/整栋计)压根没房号可对,同样不是数据缺口。
        boolean undecided() { return tokens > 0 && cands > 0 && candTokens > 0 && hits == 0; }
    }

    // §2.5b 单元候选(S17):floor=单元结构化楼层(「2F-2F整层」→2)、tokens=单元号房号token、
    // location=该单元经 billing_term_unit 绑定的计费行位置原文(premise 输出仍取合同侧文本)。
    record UnitCand(Integer floor, Set<String> tokens, String location) {}

    // §2.2 定位:表房号 ∩ 合同计费行 location 房号,唯一命中才细化,否则回退 premiseOf(不猜)。
    // 取的是合同侧原文而非表侧自描述——公摊行 premise 同源于此,前端 byPremise 才配得上。
    static String resolveMeterPremise(Meter m, Integer contractId, Map<Integer, List<String>> locs) {
        return resolveMeterPremise(m, contractId, locs, Map.of());
    }

    static String resolveMeterPremise(Meter m, Integer contractId, Map<Integer, List<String>> locs,
                                      Map<Integer, List<UnitCand>> unitCands) {
        if (contractId == null) return null;
        String p = pin(m, contractId, locs, unitCands).text();
        return p != null ? p : premiseOf(contractId, locs);
    }

    static Pin pin(Meter m, Integer contractId, Map<Integer, List<String>> locs) {
        return pin(m, contractId, locs, Map.of());
    }

    static Pin pin(Meter m, Integer contractId, Map<Integer, List<String>> locs,
                   Map<Integer, List<UnitCand>> unitCands) {
        Set<String> rt = roomTokens(m);
        List<String> ls = contractId == null ? null : locs.get(contractId);
        int cands = ls == null ? 0 : ls.size();
        if (rt.isEmpty() || cands == 0) return new Pin(null, rt.size(), cands, 0, 0);
        int ct = (int) ls.stream().flatMap(l -> tok(l).stream()).distinct().count();
        List<String> hits = ls.stream().filter(l -> tok(l).stream().anyMatch(rt::contains)).toList();
        // §2.5 整层回退(S17,三级):房号打不中计费行文本时——
        //   a. 表房号 ↔ 合同绑定单元的单元号 token,唯一 → 落该单元绑定行的 location;
        //   b. 表楼层文本(「二楼201室」→2) ↔ 单元结构化楼层(「2F-2F整层」floor=2),唯一 → 同上;
        //   c. 表楼层文本 ↔ 「无房号候选」location 的楼层文本(无单元绑定的老合同兜底)。
        // 汤周杰型:整层租户天然无房号,不该让用户编房号;歧义或表无楼层文本照旧不猜。
        if (hits.isEmpty()) {
            List<UnitCand> ucs = unitCands.getOrDefault(contractId, List.of());
            List<String> uHit = ucs.stream().filter(c -> c.tokens().stream().anyMatch(rt::contains))
                .map(UnitCand::location).distinct().toList();
            if (uHit.size() == 1) return new Pin(trunc(uHit.get(0), 64), rt.size(), cands, ct, 1);
            Integer mf = floorOf(m.getSpot(), m.getRoomNo(), m.getName(), m.getSubName());
            if (mf != null) {
                List<String> fHit = ucs.stream().filter(c -> mf.equals(c.floor()))
                    .map(UnitCand::location).distinct().toList();
                if (fHit.size() == 1) return new Pin(trunc(fHit.get(0), 64), rt.size(), cands, ct, 1);
                List<String> fh = ls.stream().filter(l -> tok(l).isEmpty() && mf.equals(floorOf(l))).toList();
                if (fh.size() == 1) return new Pin(trunc(fh.get(0), 64), rt.size(), cands, ct, 1);
            }
        }
        if (hits.size() != 1) return new Pin(null, rt.size(), cands, ct, hits.size());
        String l = hits.get(0);
        Set<String> lt = tok(l);
        List<String> inter = lt.stream().filter(rt::contains).toList();
        // |inter|>1 不合成:表确实同时管几间(一楼商铺 2101、2102),原文才是对的
        return new Pin(trunc(lt.size() > 1 && inter.size() == 1 ? synthesize(l, inter.get(0)) : l, 64),
            rt.size(), cands, ct, 1);
    }

    // §2.5 楼层抽取(整层回退用):混合文本里找「N楼/N层/NF/中文数字楼层」首个命中;首层=1。
    // 「11号楼」的 11 后跟「号」不命中;中文数字复用 AllocService.floorNum(补「楼」尾喂纯标签)。
    private static final java.util.regex.Pattern FLOOR_PAT =
        java.util.regex.Pattern.compile("([0-9]{1,2}|[一二三四五六七八九十]{1,3})\\s*[楼层F]");
    static Integer floorOf(String... texts) {
        for (String s : texts) {
            if (s == null) continue;
            if (s.contains("首层")) return 1;
            var mm = FLOOR_PAT.matcher(s);
            if (mm.find()) {
                String d = mm.group(1);
                return d.chars().allMatch(Character::isDigit)
                    ? Integer.valueOf(d) : AllocService.floorNum(d + "楼");
            }
        }
        return null;
    }

    // §2.3 把 L 中「首 token 起、末 token 止」整段换成 t,前后缀原样保留
    // (绕开 室/单元/号室 三套后缀写法,不做后缀字典)。
    static String synthesize(String l, String t) {
        var m = DIGITS.matcher(l);
        int from = -1, to = -1;
        while (m.find()) {
            if (m.end() - m.start() < 3 || m.end() - m.start() > 4) continue;
            if (from < 0) from = m.start();
            to = m.end();
        }
        return from < 0 ? l : l.substring(0, from) + t + l.substring(to);
    }

    private static BigDecimal segPrev(MeterReading r, String seg) {
        return switch (seg) { case "sharp" -> r.getPrevSharp(); case "peak" -> r.getPrevPeak();
                              case "flat" -> r.getPrevFlat(); default -> r.getPrevValley(); };
    }
    private static BigDecimal segCurr(MeterReading r, String seg) {
        return switch (seg) { case "sharp" -> r.getCurrSharp(); case "peak" -> r.getCurrPeak();
                              case "flat" -> r.getCurrFlat(); default -> r.getCurrValley(); };
    }

    // ══════════ 读侧 ══════════

    // 有单的账期升序,空表=[](前端默认月直接取 max,不再拿 /meters/years 的年再逐月试探 —— 抄表年≠出单年)
    public List<String> months() { return notices.selectDistinctYms(); }

    public List<BillNoticeDTO> list(String ym) {
        requireYm(ym);
        List<BillNotice> ns = notices.selectByYm(ym);
        if (ns.isEmpty()) return List.of();
        Map<Integer, Long> counts = noticeLines.selectMaps(new QueryWrapper<BillNoticeLine>()
                .select("notice_id", "count(*) cnt")
                .inSql("notice_id", "SELECT id FROM bill_notice WHERE ym = '" + ym + "'")
                .groupBy("notice_id"))
            .stream().collect(Collectors.toMap(
                m -> ((Number) m.get("notice_id")).intValue(), m -> ((Number) m.get("cnt")).longValue()));
        Names names = names();
        return ns.stream().map(n -> toDTO(n, names, counts.getOrDefault(n.getId(), 0L).intValue())).toList();
    }

    public BillNoticeDetailDTO detail(Integer id) {
        BillNotice n = notices.selectById(id);
        if (n == null) throw new BizException(ResultCode.NOT_FOUND, "催缴单不存在");
        Names names = names(n.getTenantId(), n.getPayCompanyId());
        List<BillNoticeLine> raw = noticeLines.selectByNotice(id);
        // 池名 join(S5 §3.2):share 行行名=「费项·池名」;池已删则 null 原样降级
        Set<Integer> rids = raw.stream().map(BillNoticeLine::getPoolRuleId)
            .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Integer, String> poolNames = rids.isEmpty() ? Map.of()
            : rules.selectBatchIds(rids).stream().collect(Collectors.toMap(AllocRule::getId, AllocRule::getName));
        List<BillNoticeDetailDTO.Line> lines = raw.stream()
            .map(l -> new BillNoticeDetailDTO.Line(l.getLineNo(), l.getFeeKey(), l.getPremise(),
                l.getMeterId(), l.getMeterLabel(), l.getContractId(), l.getSeg(),
                l.getPrevRead(), l.getCurrRead(), l.getFactorSnap(), l.getQty(), l.getPriceSnap(),
                l.getPriceKey(), l.getPriceScope(), l.getPriceMonth(), l.getRuleBranch(),
                l.getPoolRuleId(), l.getShareSrc(), l.getBaseSnap(), l.getAmount(), l.getNote(), l.getFeeGroup(),
                l.getPoolRuleId() == null ? null : poolNames.get(l.getPoolRuleId())))
            .toList();
        return new BillNoticeDetailDTO(n.getId(), n.getYm(), n.getTenantId(),
            names.tenant().get(n.getTenantId()), n.getPayCompanyId(),
            n.getPayCompanyId() == null ? null : names.company().get(n.getPayCompanyId()),
            n.getNoticeKind(), n.getPremiseText(), n.getTotalAmount(), n.getPrevDue(),
            n.getStatus(), n.getWarn(), lines);
    }

    // ── 备注人工覆盖(V92):独立表挂业务键,重生成(先删后插)不丢;显示优先级=覆盖>引擎备注(前端合成) ──
    public List<BillNoteOverride> notes(String ym, Integer tenantId) {
        requireYm(ym);
        return noteOverrides.selectList(new QueryWrapper<BillNoteOverride>()
            .eq("ym", ym).eq("tenant_id", tenantId).orderByAsc("id"));
    }

    public void saveNote(BillNoteReq req) {
        if (tenants.selectById(req.tenantId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        noteOverrides.upsertNote(req.ym(), req.tenantId(), req.feeKey(),
            emptyIfNull(req.premiseKey()), emptyIfNull(req.meterKey()), emptyIfNull(req.segKey()),
            req.note());
    }

    // 清除覆盖=恢复引擎默认备注;键未命中静默(幂等)
    public void deleteNote(String ym, Integer tenantId, String feeKey,
                           String premiseKey, String meterKey, String segKey) {
        requireYm(ym);
        noteOverrides.delete(new QueryWrapper<BillNoteOverride>()
            .eq("ym", ym).eq("tenant_id", tenantId).eq("fee_key", feeKey)
            .eq("premise_key", emptyIfNull(premiseKey))
            .eq("meter_key", emptyIfNull(meterKey))
            .eq("seg_key", emptyIfNull(segKey)));
    }

    private static String emptyIfNull(String s) { return s == null ? "" : s; }

    // ── 交付状态流(S20 §1.3):draft ──确认──> confirmed ──导出──> exported;单向,要改就作废后重生成 ──
    // 户级批量:该月这些租户的全部单一起流转(状态是单据级存储、户级展示)。

    @Transactional
    public BillDeliveryDTO.Confirm confirm(String ym, List<Integer> tenantIds) {
        String who = currentUser();
        LocalDateTime now = LocalDateTime.now();
        int confirmed = 0, skipped = 0;
        for (BillNotice n : byTenants(ym, tenantIds)) {
            if (!"draft".equals(n.getStatus())) { skipped++; continue; }  // 已确认/已导出/已作废原样跳过
            n.setStatus("confirmed");
            n.setConfirmedAt(now);
            n.setConfirmedBy(who);
            notices.updateById(n);
            confirmed++;
        }
        return new BillDeliveryDTO.Confirm(confirmed, skipped);
    }

    // 导出后回标;重复导出刷新 exported_at(「最近一次导出时间」)。已作废单不动。
    @Transactional
    public BillDeliveryDTO.Export markExported(String ym, List<Integer> tenantIds) {
        LocalDateTime now = LocalDateTime.now();
        int marked = 0;
        for (BillNotice n : byTenants(ym, tenantIds)) {
            if ("void".equals(n.getStatus())) continue;
            n.setStatus("exported");
            n.setExportedAt(now);
            notices.updateById(n);
            marked++;
        }
        return new BillDeliveryDTO.Export(marked);
    }

    private List<BillNotice> byTenants(String ym, List<Integer> tenantIds) {
        requireYm(ym);
        if (tenantIds == null || tenantIds.isEmpty()) return List.of();
        return notices.selectList(new QueryWrapper<BillNotice>()
            .eq("ym", ym).in("tenant_id", tenantIds).orderByAsc("id"));
    }

    private static String currentUser() {
        var auth = org.springframework.security.core.context.SecurityContextHolder
            .getContext().getAuthentication();
        return auth == null ? null : auth.getName();
    }

    // 仅 issued/draft 可 void;issue 仅 draft(issued 不可被重跑覆盖,须先 void)
    public BillNoticeDTO voidNotice(Integer id) { return transition(id, "void"); }
    public BillNoticeDTO issue(Integer id) { return transition(id, "issued"); }

    private BillNoticeDTO transition(Integer id, String to) {
        BillNotice n = notices.selectById(id);
        if (n == null) throw new BizException(ResultCode.NOT_FOUND, "催缴单不存在");
        boolean ok = "void".equals(to) ? !"void".equals(n.getStatus()) : "draft".equals(n.getStatus());
        if (!ok) throw new BizException(ResultCode.CONFLICT,
            "void".equals(to) ? "该单已作废" : "仅草稿单可签发,当前状态=" + n.getStatus());
        n.setStatus(to);
        notices.updateById(n);
        return toDTO(n, names(n.getTenantId(), n.getPayCompanyId()), (int) (long) noticeLines.selectCount(
            new QueryWrapper<BillNoticeLine>().eq("notice_id", id)));
    }

    /** 单据路径(detail/transition)只渲染一张单,names 的两个 map 只被 get(n.getTenantId())/
     *  get(n.getPayCompanyId()) 读一次 —— 点查两条即可,不必为一张单把租户表+公司表整表拉回来。
     *  查无(租户被删/未指定收款公司)给空表,与全表字典 miss 同为 null。 */
    private Names names(Integer tenantId, Integer companyId) {
        Tenant t = tenantId == null ? null : tenants.selectById(tenantId);
        ManagementCompany c = companyId == null ? null : companies.selectById(companyId);
        return new Names(t == null ? Map.of() : Map.of(t.getId(), t.getCompanyName()),
                         c == null ? Map.of() : Map.of(c.getId(), c.getName()));
    }

    private record Names(Map<Integer, String> tenant, Map<Integer, String> company) {}
    private Names names() {
        return new Names(
            tenants.selectList(null).stream().collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName)),
            companies.selectList(null).stream().collect(Collectors.toMap(ManagementCompany::getId, ManagementCompany::getName)));
    }

    private static BillNoticeDTO toDTO(BillNotice n, Names names, int lineCount) {
        return new BillNoticeDTO(n.getId(), n.getYm(), n.getTenantId(), names.tenant().get(n.getTenantId()),
            n.getPayCompanyId(), n.getPayCompanyId() == null ? null : names.company().get(n.getPayCompanyId()),
            n.getNoticeKind(), n.getPremiseText(), n.getTotalAmount(), n.getPrevDue(),
            n.getStatus(), n.getWarn(), lineCount, n.getConfirmedAt(), n.getExportedAt());
    }

    // ══════════ helpers ══════════
    private static String circled(int n) {
        return n >= 1 && n <= 20 ? String.valueOf(CIRCLED.charAt(n - 1)) : "#" + n;
    }
    private static BigDecimal r2(BigDecimal v) { return v.setScale(2, RoundingMode.HALF_UP); }
    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static String trunc(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式须为 YYYY-MM");
    }
}
