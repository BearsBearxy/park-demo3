package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.BillNoticeDTO;
import com.park.demo3.dto.BillNoticeDetailDTO;
import com.park.demo3.dto.BillNoticeGenResultDTO;
import com.park.demo3.dto.MeterBindingDTO;
import com.park.demo3.entity.AllocPoolResult;
import com.park.demo3.entity.AllocRule;
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
import com.park.demo3.mapper.AllocRuleMapper;
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
// 存在 issued 单的租户整户跳过并计入 warned 摘要。
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
    private static final ObjectMapper JSON = new ObjectMapper();   // rent_free 解析(与 ContractService 同口径)

    private final BillNoticeMapper notices;
    private final BillNoticeLineMapper noticeLines;
    private final MeterMapper meters;
    private final MeterReadingMapper readings;
    private final ContractMapper contracts;
    private final ContractBillingTermMapper billingTerms;
    private final TenantMapper tenants;
    private final ManagementCompanyMapper companies;
    private final BillPayCompanyMapper payMap;
    private final AllocRuleMapper rules;
    private final AllocPoolResultMapper poolResults;
    private final PriceCfgService price;
    private final AllocService alloc;
    private final MeterBindingService binding;

    public BillNoticeService(BillNoticeMapper notices, BillNoticeLineMapper noticeLines,
                             MeterMapper meters, MeterReadingMapper readings,
                             ContractMapper contracts, ContractBillingTermMapper billingTerms,
                             TenantMapper tenants, ManagementCompanyMapper companies,
                             BillPayCompanyMapper payMap, AllocRuleMapper rules,
                             AllocPoolResultMapper poolResults, PriceCfgService price,
                             AllocService alloc, MeterBindingService binding) {
        this.notices = notices; this.noticeLines = noticeLines;
        this.meters = meters; this.readings = readings;
        this.contracts = contracts; this.billingTerms = billingTerms;
        this.tenants = tenants; this.companies = companies;
        this.payMap = payMap; this.rules = rules; this.poolResults = poolResults;
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

        // 幂等:draft 先删;void 一并清(uk_notice 不含 status,作废单留着会撞重生成的新 draft;行由 FK CASCADE 连删)
        notices.delete(new QueryWrapper<BillNotice>().eq("ym", ym).in("status", "draft", "void"));
        Set<Integer> issuedTenants = notices.selectList(new QueryWrapper<BillNotice>()
                .eq("ym", ym).eq("status", "issued"))
            .stream().map(BillNotice::getTenantId).collect(Collectors.toSet());

        // ── 语境 ──
        Map<Integer, Meter> meterById = new HashMap<>();
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
            if (ContractService.BUILDING_RENT_KEYS.contains(t.getFeeKey()) && t.getArea() != null)
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
                // 无房号与多命中都不是「未定」,不出噪音(判据见 Pin.undecided)
                if (pin(m, row.contractId(), locsByContract).undecided())
                    warnByTenant.computeIfAbsent(tid, k -> new LinkedHashSet<>())
                        .add("场地未定:" + m.getName());
                if ("elec".equals(m.getKind()))
                    elecLines(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locsByContract);
                else
                    waterLines(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locsByContract);
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
                    } else if (o.poolRuleId != null && ("share_elec_floor".equals(o.feeKey)
                            || "share_elec_elevator".equals(o.feeKey) || "share_elec_fire".equals(o.feeKey))) {
                        AllocRule pr = ruleById.get(o.poolRuleId);
                        inShare = pr != null && pr.getBuildingId() != null && chain.contains(pr.getBuildingId());
                    }
                    if (!inElec && !inShare) continue;
                    BigDecimal[] acc = byPremise.computeIfAbsent(wide(o),
                        k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
                    if (inElec) { acc[0] = acc[0].add(o.amount); if (o.qty != null) acc[2] = acc[2].add(o.qty); }
                    else acc[1] = acc[1].add(o.amount);
                    if (o.contractId != null) cidByPremise.putIfAbsent(wide(o), o.contractId);
                }
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
                        + ")×率 " + l.rateTmp, 255);
                }
            }
            ls.addAll(lossSplit);
        }

        // ── 拆单归集(§4):行→colId→bill_pay_company;宿舍段整段进 dorm 单收 dormRent 映射;offbook 户全单 offbook ──
        record NKey(Integer tenantId, Integer companyId, String kind) {}
        Map<NKey, List<L>> groups = new LinkedHashMap<>();
        int skippedIssued = 0;
        Set<Integer> seenSkipped = new LinkedHashSet<>();
        for (Map.Entry<Integer, List<L>> e : byTenant.entrySet()) {
            Integer tid = e.getKey();
            if (issuedTenants.contains(tid)) { if (seenSkipped.add(tid)) skippedIssued++; continue; }
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
        int generated = 0, lineCount = 0, warned = skippedIssued;
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
                noticeLines.insert(row);
                lineCount++;
            }
            generated++;
        }

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
        return new BillNoticeGenResultDTO(generated, lineCount, warned, batch);
    }

    // ── 电表判定树B:elec_package 户级命中→包干单行 / 分时(curr_peak|flat|valley 任一非空)→四段+mgmt0.16
    //    / is_dorm_room→居民+mgmt0.16 / 商业+mgmt0.32;户级例外由 resolveHit 的 scope 链天然覆盖 ──
    private void elecLines(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                           String ym, Integer tid, Meter m, MeterBindingDTO.Row row, MeterReading r,
                           String label, Map<Integer, List<String>> locs) {
        boolean dormRoom = m.getIsDormRoom() != null && m.getIsDormRoom() == 1;
        String zone = dormRoom ? "dorm" : m.getZone();
        BigDecimal f = r.getFactorSnap();
        BigDecimal total = MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), f);
        // 包干:户级键命中(scope=tenant:)⇒全部用量×包干价单行,不出 mgmt 行(§5 要点)
        PriceCfgService.PriceHit pkg = price.resolveHit("elec_package", ym, tid, zone);
        if (pkg != null && pkg.scope().startsWith("tenant:")) {
            if (total == null) return;
            L l = meterLine(byTenant, seq, tid, m, row, label, locs, dormRoom, "elec", "elec_package", null,
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
                L l = meterLine(byTenant, seq, tid, m, row, label, locs, dormRoom, "elec",
                    "elec_" + seg, seg, prev, curr, f, u, hit, tenantOverride(hit, "tou"));
                l.priceSnap = p;
                l.amount = r2(u.multiply(p));
                l.note = note;
            }
        } else if (dormRoom) {
            mgmtKey = "mgmt_fee";
            singlePrice(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locs, true,
                "elec", "elec_resident", zone, total, "resident");
        } else {
            mgmtKey = "mgmt_fee_commercial";
            singlePrice(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locs, false,
                "elec", "elec_commercial", zone, total, "commercial");
        }
        // 电力管理费:基数×费率;分时表基数=Σ段用量(E3),否则总用量;费率查无或为 0 不出行(§5 要点);逐表落行保 meter 关联
        BigDecimal mgmtBase = segSum != null ? segSum : total;
        if (mgmtBase == null) return;
        PriceCfgService.PriceHit mg = price.resolveHit(mgmtKey, ym, tid, zone);
        if (mg == null || mg.value().signum() == 0) return;
        L l = meterLine(byTenant, seq, tid, m, row, label, locs, dormRoom, "mgmt_fee", mgmtKey, null,
            null, null, f, mgmtBase, mg, tenantOverride(mg, "fixed"));
        l.amount = r2(mgmtBase.multiply(mg.value()));
        if (total != null && segSum != null && segSum.compareTo(total) != 0)
            l.note = trunc("管理费基数=Σ段 " + segSum + "(总示数 " + total + ")", 255);
    }

    // ── 水表:is_dorm_room→3.85+管网0(dorm scope 天然给 0=不出行)/否则 3.95+0.5;户级例外同链 ──
    private void waterLines(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                            String ym, Integer tid, Meter m, MeterBindingDTO.Row row, MeterReading r,
                            String label, Map<Integer, List<String>> locs) {
        boolean dormRoom = m.getIsDormRoom() != null && m.getIsDormRoom() == 1;
        String zone = dormRoom ? "dorm" : m.getZone();
        BigDecimal total = MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
        if (total == null) return;
        singlePrice(byTenant, warnByTenant, seq, ym, tid, m, row, r, label, locs, dormRoom,
            "water", "water", zone, total, dormRoom ? "resident" : "commercial");
        PriceCfgService.PriceHit pipe = price.resolveHit("water_pipe", ym, tid, zone);
        if (pipe == null || pipe.value().signum() == 0) return;
        L l = meterLine(byTenant, seq, tid, m, row, label, locs, dormRoom, "water_pipe", "water_pipe", null,
            null, null, r.getFactorSnap(), total, pipe, tenantOverride(pipe, "fixed"));
        l.amount = r2(total.multiply(pipe.value()));
    }

    // 单一价行(电居民/电商业/水)
    private void singlePrice(Map<Integer, List<L>> byTenant, Map<Integer, Set<String>> warnByTenant, int[] seq,
                             String ym, Integer tid, Meter m, MeterBindingDTO.Row row, MeterReading r,
                             String label, Map<Integer, List<String>> locs, boolean dormRoom,
                             String feeKey, String priceKey, String zone, BigDecimal total, String branch) {
        if (total == null) return;
        PriceCfgService.PriceHit hit = price.resolveHit(priceKey, ym, tid, zone);
        if (hit == null) { missPrice(warnByTenant, tid, priceKey, ym); return; }
        L l = meterLine(byTenant, seq, tid, m, row, label, locs, dormRoom, feeKey, priceKey, null,
            r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap(), total, hit, tenantOverride(hit, branch));
        l.amount = r2(total.multiply(hit.value()));
    }

    // 表行公共骨架(审计链 price_key/scope/month + 合同快照 + 场地段)
    private L meterLine(Map<Integer, List<L>> byTenant, int[] seq, Integer tid, Meter m,
                        MeterBindingDTO.Row row, String label, Map<Integer, List<String>> locs, boolean dorm,
                        String feeKey, String cfgKey, String seg, BigDecimal prev, BigDecimal curr, BigDecimal f,
                        BigDecimal qty, PriceCfgService.PriceHit hit, String branch) {
        L l = new L();
        l.tenantId = tid; l.seq = seq[0]++; l.dorm = dorm;
        l.feeKey = feeKey; l.seg = seg;
        l.meterId = m.getId(); l.meterLabel = label;
        l.contractId = row.contractId();
        l.premise = resolveMeterPremise(m, row.contractId(), locs);   // S6 §2.2 表行场地跟表走,不跟合同走
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
        BigDecimal collect = c.rate();   // p1/dorm 与 live 例外:收取价=当月核算率
        if (rule != null && "p2".equals(rule.getZone())) {
            String key = lampFee ? "lamp_rate" : "green_rate";
            PriceCfgService.PriceHit live = price.resolveHit(key + "_live", ym, l.tenantId, "p2");
            if (live != null && live.scope().startsWith("tenant:") && live.value().signum() != 0) {
                l.priceKey = key + "_live"; l.priceScope = live.scope(); l.priceMonth = live.acctMonth();
                l.note = trunc("收取价=当月核算率(live 例外)", 255);
            } else {
                PriceCfgService.PriceHit hit = price.resolveHit(key, ym, l.tenantId, "p2");
                if (hit == null) return;   // 冻结常数未录:维持核算口径原行不硬改(SQL① 应用后自然生效)
                collect = hit.value();
                l.priceKey = key; l.priceScope = hit.scope(); l.priceMonth = hit.acctMonth();
                l.note = trunc("核算率 " + (c.rate() == null ? "-" : c.rate().stripTrailingZeros().toPlainString()) + " 备查", 255);
            }
        }
        if (collect == null) return;
        l.priceSnap = collect;
        l.amount = r2(collect.multiply(base));
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
    // tokens=表侧抽出的房号数、cands=该合同候选计费行数、hits=其中被命中的条数
    // ——后三项是 §2.4 告警的判据(调用方必须能分开「无房号」「多命中」「真·零命中」三种 null)。
    record Pin(String text, int tokens, int cands, int hits) {
        // §2.4「真·零命中」=表有房号、合同有候选计费行,却一条都对不上(D3 借表/挂错合同,人工归属可消)。
        // 无房号(开利暖通整栋表、翔海借电)无场地可定,告警永远消不掉=噪音;
        // 多命中(桑尼号「二楼201、301室」)与 §2.2 |inter|>1「取原文=已定场地」同构,更不是未定。
        boolean undecided() { return tokens > 0 && cands > 0 && hits == 0; }
    }

    // §2.2 定位:表房号 ∩ 合同计费行 location 房号,唯一命中才细化,否则回退 premiseOf(不猜)。
    // 取的是合同侧原文而非表侧自描述——公摊行 premise 同源于此,前端 byPremise 才配得上。
    static String resolveMeterPremise(Meter m, Integer contractId, Map<Integer, List<String>> locs) {
        if (contractId == null) return null;
        String p = pin(m, contractId, locs).text();
        return p != null ? p : premiseOf(contractId, locs);
    }

    static Pin pin(Meter m, Integer contractId, Map<Integer, List<String>> locs) {
        Set<String> rt = roomTokens(m);
        List<String> ls = contractId == null ? null : locs.get(contractId);
        int cands = ls == null ? 0 : ls.size();
        if (rt.isEmpty() || cands == 0) return new Pin(null, rt.size(), cands, 0);
        List<String> hits = ls.stream().filter(l -> tok(l).stream().anyMatch(rt::contains)).toList();
        if (hits.size() != 1) return new Pin(null, rt.size(), cands, hits.size());
        String l = hits.get(0);
        Set<String> lt = tok(l);
        List<String> inter = lt.stream().filter(rt::contains).toList();
        // |inter|>1 不合成:表确实同时管几间(一楼商铺 2101、2102),原文才是对的
        return new Pin(trunc(lt.size() > 1 && inter.size() == 1 ? synthesize(l, inter.get(0)) : l, 64),
            rt.size(), cands, 1);
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
        Names names = names();
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
        return toDTO(n, names(), (int) (long) noticeLines.selectCount(
            new QueryWrapper<BillNoticeLine>().eq("notice_id", id)));
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
            n.getStatus(), n.getWarn(), lineCount);
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
