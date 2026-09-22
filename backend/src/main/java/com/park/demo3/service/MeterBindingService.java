package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.AutoLinkResultDTO;
import com.park.demo3.dto.MeterBindingDTO;
import com.park.demo3.dto.MeterUsageSummaryDTO;
import com.park.demo3.entity.Building;
import com.park.demo3.entity.Contract;
import com.park.demo3.entity.ContractBillingTerm;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.BuildingMapper;
import com.park.demo3.mapper.ContractBillingTermMapper;
import com.park.demo3.mapper.ContractMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.security.NoReviewGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

// 表→合同绑定(S2-BIND-SPEC):归属五级规则读侧派生,抄表数据模型不动。
// 家族根=COALESCE(tenant.parent_id,id);在租语义同 ContractService.inForceOn(非草稿+起止齐全),
// 点判定放宽为月区间重叠(start≤月末 AND end≥月初)。不设静默兜底:无日期合同进 manual/date_missing 一键确认。
@Service
public class MeterBindingService {
    // 占位原文集合(§2):不计入待核收敛指标
    private static final Set<String> PLACEHOLDER = Set.of("-", "（空）", "已停用");
    private static final List<String> BUCKETS = List.of("date_missing", "ambiguous", "bld_mismatch", "no_contract");

    private final MeterMapper meters;
    private final MeterReadingMapper readings;
    private final ContractMapper contracts;
    private final TenantMapper tenants;
    private final BuildingMapper buildings;
    private final ContractBillingTermMapper billingTerms;

    public MeterBindingService(MeterMapper meters, MeterReadingMapper readings,
                               ContractMapper contracts, TenantMapper tenants, BuildingMapper buildings,
                               ContractBillingTermMapper billingTerms) {
        this.meters = meters; this.readings = readings;
        this.contracts = contracts; this.tenants = tenants; this.buildings = buildings;
        this.billingTerms = billingTerms;
    }

    // 费项位置标签(2026-08-04 用户要求"不单止办公室,要把单元也显示出来"):
    // 每个 distinct location 一条「费项名去『租金』尾·位置原文」——位置原文本就含栋层单元
    // (如 A座孵化器三楼315室);取该位置 seq 最小行的费项名(导入约定租金行居首)。位置空的行不出标签。
    static List<String> locLabels(List<ContractBillingTerm> lines) {
        LinkedHashMap<String, String> byLoc = new LinkedHashMap<>();
        for (ContractBillingTerm t : lines) {
            String loc = t.getLocation();
            if (loc == null || loc.isBlank()) continue;
            String fee = t.getFeeName() == null ? "" : t.getFeeName().replaceAll("租金$", "");
            byLoc.putIfAbsent(loc.trim(), fee);
        }
        return byLoc.entrySet().stream()
            .map(e -> e.getValue().isBlank() ? e.getKey() : e.getValue() + "·" + e.getKey())
            .toList();
    }

    // ── 归属报表(§2 五级规则+分桶;§3 报表形状) ──
    public MeterBindingDTO resolveBinding(String ym) {
        LocalDate first;
        try { first = LocalDate.parse(ym + "-01"); }
        catch (DateTimeParseException e) { throw new BizException(ResultCode.BAD_REQUEST, "月份格式非法(应为 YYYY-MM)"); }
        LocalDate last = first.withDayOfMonth(first.lengthOfMonth());

        Map<Integer, Integer> root = familyRoots();
        Map<Integer, Contract> byId = new HashMap<>();
        Map<Integer, List<Contract>> famContracts = new HashMap<>();   // 家族根 → 非草稿合同
        for (Contract c : contracts.selectList(null)) {
            byId.put(c.getId(), c);
            if ("draft".equals(c.getStatus())) continue;
            famContracts.computeIfAbsent(root.getOrDefault(c.getTenantId(), c.getTenantId()),
                k -> new ArrayList<>()).add(c);
        }
        // 递增段/续签链:parent_contract_id 连成的单链(V57 link_type new|renew|escalation)。
        // 规则1 按月落段要用它 —— 见下面 segmentCovering 的注释。
        Map<Integer, Integer> chainRoot = new HashMap<>();
        for (Contract c : byId.values()) chainRoot.put(c.getId(), chainRootOf(c, byId));
        Map<Integer, List<Contract>> chainMembers = new HashMap<>();   // 链首 id → 本链非草稿各段
        for (Contract c : byId.values()) {
            if ("draft".equals(c.getStatus())) continue;
            chainMembers.computeIfAbsent(chainRoot.get(c.getId()), k -> new ArrayList<>()).add(c);
        }
        Map<Integer, MeterReading> readByMeter = readingsByMeter(ym);
        Map<Integer, String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        // 费项位置标签(每合同一次;整表一读同 contracts.selectList 口径,行内按 seq,id 序保租金行居首)
        Map<Integer, List<String>> locsByContract = billingTerms.selectList(null).stream()
            .sorted(Comparator.comparing((ContractBillingTerm t) -> t.getSeq() == null ? 0 : t.getSeq())
                .thenComparing(ContractBillingTerm::getId))
            .collect(Collectors.groupingBy(ContractBillingTerm::getContractId, LinkedHashMap::new, Collectors.toList()))
            .entrySet().stream()
            .collect(Collectors.toMap(Map.Entry::getKey, e -> locLabels(e.getValue())));

        List<MeterBindingDTO.Row> rows = new ArrayList<>();
        Map<String, Integer> counts = new HashMap<>();
        Map<String, Integer> manual = new LinkedHashMap<>();
        BUCKETS.forEach(b -> manual.put(b, 0));
        int missing = 0;

        for (Meter m : meters.selectFiltered(null, null)) {
            // 非租户表(含 park 园区自担)不参与绑定;已停用表本月不在服务中,不进待核/待绑定分母(V68);
            // shadow=疑似重复建档,同 AllocService 排除口径(V75 §F1),不进绑定分母
            if (!"tenant".equals(m.getOwnership()) || MeterService.outOfService(m, ym)
                || "shadow".equals(m.getSuspect())) continue;
            boolean hasReading = usable(readByMeter.get(m.getId()));
            if (!hasReading) missing++;

            String status; String bucket = null; Contract chosen = null; List<Contract> cands = List.of();
            // 规则1(2026-09-23 改写):人工绑定钉的是**一份合同**,不是它的某一段。
            // 递增段与续签是同一份合同的分期(V57 link_type escalation|renew,拆链 spec §1「派生一视同仁」),
            // 租金那边一直是按月挑段的(BillNoticeService 走 covers()),只有这里钉死一段 ——
            // 于是旭化成 2023-08 那张单上租金挂 C2024M-022A#2、水电挂 #3(2023-10-27 才生效),全库 203 行。
            Contract pinned = m.getContractId() == null ? null : byId.get(m.getContractId());
            Contract seg = pinned == null ? null : segmentCovering(pinned, chainMembers, chainRoot, first, last);
            if (m.getTenantId() == null) {
                status = meaningless(m.getTenantName()) ? "placeholder" : "pending";
            } else if (seg != null) {
                status = "override"; chosen = seg;   // seg==pinned 即原先的「直接采用」
            } else {
                List<Contract> fam = famContracts.getOrDefault(
                    root.getOrDefault(m.getTenantId(), m.getTenantId()), List.of());
                List<Contract> covering = fam.stream().filter(c -> covers(c, first, last)).toList();
                if (covering.size() == 1) { status = "auto"; chosen = covering.get(0); }          // 规则3
                else if (covering.size() > 1) {                                                   // 规则4:楼栋对位
                    List<Contract> bld = covering.stream()
                        .filter(c -> Objects.equals(c.getBuildingId(), m.getBuildingId())).toList();
                    if (bld.size() == 1) { status = "auto_bld"; chosen = bld.get(0); }
                    else if (bld.isEmpty()) {
                        // 仁恒形态(2026-08-04 报障):多楼栋合同户,别栋在租合同遮蔽本栋缺日期合同——
                        // 规则2只收起止齐全的,规则5又只在零覆盖时轮到 date_missing,结果对位正确的
                        // 宿舍合同(S10-0062)根本不进候选,抽屉只给错栋候选。本栋缺日期合同优先浮出
                        // (§2"不设静默兜底"的本意:缺日期必须可见可确认),唯一时 UI 一键确认。
                        List<Contract> bldNoDates = fam.stream()
                            .filter(c -> c.getStartDate() == null || c.getEndDate() == null)
                            .filter(c -> Objects.equals(c.getBuildingId(), m.getBuildingId())).toList();
                        status = "manual";
                        if (!bldNoDates.isEmpty()) { bucket = "date_missing"; cands = bldNoDates; }
                        else { bucket = "bld_mismatch"; cands = covering; }
                    } else { status = "manual"; bucket = "ambiguous"; cands = covering; }
                } else {                                                                          // 规则5:分桶
                    List<Contract> noDates = fam.stream()
                        .filter(c -> c.getStartDate() == null || c.getEndDate() == null).toList();
                    status = "manual";
                    if (!noDates.isEmpty()) { bucket = "date_missing"; cands = noDates; }   // 唯一时 UI 一键确认=写 override
                    else bucket = "no_contract";   // 含「有日期但不覆盖该月」:该月无可用合同
                }
                // 钉过合同、本月落不到段、自动也定不出 → override_stale(不是 manual:有人指认过,
                // 该留着他指的那一份)。候选照给 —— 原先这一档候选恒空,抽屉上只剩「该户无候选合同」,
                // 而该户本月明明有能用的合同,除了解绑没有第二条出路。
                if (pinned != null && "manual".equals(status)) {
                    status = "override_stale"; bucket = null; chosen = pinned;
                }
            }
            if ("manual".equals(status)) manual.merge(bucket, 1, Integer::sum);
            else counts.merge(status, 1, Integer::sum);
            Integer cid = chosen != null ? chosen.getId() : m.getContractId();
            boolean noBind = "pending".equals(status) || "placeholder".equals(status);
            // 钉的那份没被直接用上时把它带出去:屏上要说清「钉的是哪份、本月落在哪份」,
            // 不静默替换(§2「不设静默兜底」)。落回同一份时为 null,contractNo 已经是它。
            String pinNo = pinned != null && chosen != null && !pinned.getId().equals(chosen.getId())
                ? pinned.getContractNo() : null;
            rows.add(new MeterBindingDTO.Row(m.getId(), status, bucket,
                noBind ? null : cid,
                chosen == null ? null : chosen.getContractNo(), pinNo,
                noBind || cid == null ? List.of() : locsByContract.getOrDefault(cid, List.of()),
                cands.stream().map(c -> new MeterBindingDTO.Candidate(c.getId(), c.getContractNo(),
                    bName.get(c.getBuildingId()), c.getStartDate(), c.getEndDate(),
                    locsByContract.getOrDefault(c.getId(), List.of()))).toList(),
                hasReading));
        }
        MeterBindingDTO.Summary summary = new MeterBindingDTO.Summary(
            counts.getOrDefault("auto", 0), counts.getOrDefault("auto_bld", 0),
            counts.getOrDefault("override", 0), counts.getOrDefault("override_stale", 0),
            manual, counts.getOrDefault("pending", 0), counts.getOrDefault("placeholder", 0), missing);
        return new MeterBindingDTO(summary, rows);
    }

    // ── 人工绑定/解绑(写 override;§3) ──
    // 2026-09-09 裁定(此前挂在 ReviewGuardCoverageTest.PENDING_ADJUDICATION 里等人拍板):不守。
    @NoReviewGuard(reason = "只写 meter.contract_id 一列,meter 表的两个月份列(active_from_ym/retired_ym)不碰;绑定进的是读侧派生 resolveBinding(ym),而落库的两处都在守卫后面且各自按 ym 存快照 —— alloc_result 是「按 ym 先删后插」的表(AllocService §1),唯一写者 generate(ym) 开头就守 ALLOC 与 ALLOC_LOSS;bill_notice_line.contract_id 是出账时的归属快照(V89 建表注释:绑定是表级属性,不快照则回溯漂移),唯一写者 BillNoticeService.generate(ym) 守 BILL_NOTICES。所以改绑定动不了已审月已经存下来的数,重算那条路本来就被守着;反过来挂上唯一能用的 assertNoLockedMonth 就是「任一月审过 → 全园区的表再也不能改绑定」")
    @Transactional
    public void bind(Integer meterId, Integer contractId) {
        Meter m = meters.selectById(meterId);
        if (m == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        if (contractId != null && contracts.selectById(contractId) == null)
            throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        m.setContractId(contractId);   // null=解绑(FieldStrategy.ALWAYS 落库)
        meters.updateById(m);
    }

    // ── 按企业名称原文=租户档案名(含别名,V86) 精确唯一匹配批量挂 tenant_id;幂等(§3) ──
    // 同 bind,同一次裁定(2026-09-09)。
    @NoReviewGuard(reason = "同 bind 的数据流:只写 meter.tenant_id,且 WHERE 限定 ownership='tenant' AND tenant_id IS NULL —— 从空到有,不改任何已有绑定,已审月出账时用的归属快照(bill_notice_line.contract_id / 按 ym 存的 alloc_result)一个都动不到。而且它一次扫全库,连「这批写落在哪几个月」都不存在,挂上守卫只能是 assertNoLockedMonth,后果是任一月审过 → 批量挂租户功能永久失效")
    @Transactional
    public AutoLinkResultDTO autoLinkByName() {
        Map<String, List<Tenant>> byName = new HashMap<>();
        for (Tenant t : tenants.selectList(null))
            for (String n : TenantService.matchNames(t))
                byName.computeIfAbsent(n, k -> new ArrayList<>()).add(t);
        int linked = 0, skipped = 0;
        // 收敛下推:前两个 continue 条件即 WHERE(被它们跳过的行既不进 linked 也不进 skipped,计数不变);
        // meaningless() 含占位名集合判断,留在 Java 侧不下推
        for (Meter m : meters.selectList(new QueryWrapper<Meter>()
                .eq("ownership", "tenant").isNull("tenant_id"))) {
            if (meaningless(m.getTenantName())) continue;   // 仅待核表
            List<Tenant> hit = byName.get(m.getTenantName().trim());
            if (hit != null && hit.size() == 1) {
                m.setTenantId(hit.get(0).getId());
                meters.updateById(m);
                linked++;
            } else skipped++;
        }
        return new AutoLinkResultDTO(linked, skipped);
    }

    // ── 户×月聚合(S3 输入面;仅 ownership=tenant 且已挂租户的表;复用 MeterService.usage) ──
    public List<MeterUsageSummaryDTO> usageSummary(String ym) {
        Map<Integer, MeterReading> readByMeter = readingsByMeter(ym);
        Map<Integer, String> tName = tenants.selectList(null).stream()
            .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));
        Map<String, Agg> byKey = new LinkedHashMap<>();
        for (Meter m : meters.selectFiltered(null, null)) {
            if (!"tenant".equals(m.getOwnership()) || m.getTenantId() == null
                || MeterService.outOfService(m, ym)
                || "shadow".equals(m.getSuspect())) continue;   // 停用/未启用/shadow重复建档不进计费输入面(V68/V87/V75)
            Agg a = byKey.computeIfAbsent(m.getTenantId() + "|" + m.getKind(), k -> {
                Agg n = new Agg(); n.tenantId = m.getTenantId(); n.kind = m.getKind(); return n;
            });
            a.meterCount++;
            MeterReading r = readByMeter.get(m.getId());
            if (!usable(r)) a.missing++;
            if (r == null) continue;
            BigDecimal f = r.getFactorSnap();
            a.total  = nsum(a.total,  MeterService.usage(r.getPrevTotal(),  r.getCurrTotal(),  f));
            a.sharp  = nsum(a.sharp,  MeterService.usage(r.getPrevSharp(),  r.getCurrSharp(),  f));
            a.peak   = nsum(a.peak,   MeterService.usage(r.getPrevPeak(),   r.getCurrPeak(),   f));
            a.flat   = nsum(a.flat,   MeterService.usage(r.getPrevFlat(),   r.getCurrFlat(),   f));
            a.valley = nsum(a.valley, MeterService.usage(r.getPrevValley(), r.getCurrValley(), f));
        }
        return byKey.values().stream()
            .map(a -> new MeterUsageSummaryDTO(a.tenantId, tName.get(a.tenantId), a.kind,
                a.meterCount, a.missing, a.total, a.sharp, a.peak, a.flat, a.valley))
            .sorted(Comparator.comparing(MeterUsageSummaryDTO::tenantId)
                .thenComparing(MeterUsageSummaryDTO::kind))
            .toList();
    }

    // ── helpers ──
    private static final class Agg {
        Integer tenantId; String kind;
        int meterCount, missing;
        BigDecimal total, sharp, peak, flat, valley;
    }

    private Map<Integer, Integer> familyRoots() {   // tenant.id → COALESCE(parent_id,id)
        return tenants.selectList(null).stream().collect(Collectors.toMap(Tenant::getId,
            t -> t.getParentId() == null ? t.getId() : t.getParentId(), (a, b) -> a));
    }

    private Map<Integer, MeterReading> readingsByMeter(String ym) {
        return readings.selectByYm(ym).stream()
            .collect(Collectors.toMap(MeterReading::getMeterId, Function.identity()));
    }

    // 漏抄口径同 MeterService:缺读数行或总用量不可派生(缺 prev/curr)
    private static boolean usable(MeterReading r) {
        return r != null && MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap()) != null;
    }

    private static boolean meaningless(String tenantName) {
        return tenantName == null || tenantName.isBlank() || PLACEHOLDER.contains(tenantName.trim());
    }

    // 候选覆盖判定:非草稿+起止齐全+月区间重叠(§2 规则2)。AllocService 受益人候选复用同一在租语义(V69)
    public static boolean covers(Contract c, LocalDate first, LocalDate last) {
        if ("draft".equals(c.getStatus())) return false;
        if (c.getStartDate() == null || c.getEndDate() == null) return false;
        return !c.getStartDate().isAfter(last) && !c.getEndDate().isBefore(first);
    }

    // 链首:沿 parent_contract_id 上溯。guard 防脏数据成环(分叉告警在前端 chain.ts,这里只求不挂)
    private static Integer chainRootOf(Contract c, Map<Integer, Contract> byId) {
        Contract w = c;
        for (int guard = 0; guard < 64; guard++) {
            Contract p = w.getParentContractId() == null ? null : byId.get(w.getParentContractId());
            if (p == null || p.getId().equals(w.getId())) break;
            w = p;
        }
        return w.getId();
    }

    // 规则1 的按月落段:钉的那份所在链上覆盖 ym 的那一段。
    //  · 缺起止日期的绑定原样采用 —— date_missing 桶的「一键确认」写的就是这种,
    //    拒用会让那批表永久变红(§4.5 原本用 staleFor 保的就是这一条);
    //  · 段是对租期的分区,正常恰好命中一段;0 段(链断了/该月这户真没合同)或多段(脏数据)
    //    都返回 null,交给规则 2-5 的自动归属去判,判不出才是 override_stale。
    private static Contract segmentCovering(Contract pinned, Map<Integer, List<Contract>> chainMembers,
                                            Map<Integer, Integer> chainRoot, LocalDate first, LocalDate last) {
        if (pinned.getStartDate() == null || pinned.getEndDate() == null) return pinned;
        if (covers(pinned, first, last)) return pinned;
        List<Contract> hit = chainMembers.getOrDefault(chainRoot.get(pinned.getId()), List.of())
            .stream().filter(c -> covers(c, first, last)).toList();
        return hit.size() == 1 ? hit.get(0) : null;
    }

    private static BigDecimal nsum(BigDecimal a, BigDecimal b) {
        return b == null ? a : a == null ? b : a.add(b);
    }
}
