package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.AutoLinkResultDTO;
import com.park.demo3.dto.MeterBindingDTO;
import com.park.demo3.dto.MeterUsageSummaryDTO;
import com.park.demo3.entity.Building;
import com.park.demo3.entity.Contract;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.BuildingMapper;
import com.park.demo3.mapper.ContractMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.park.demo3.mapper.TenantMapper;
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

    public MeterBindingService(MeterMapper meters, MeterReadingMapper readings,
                               ContractMapper contracts, TenantMapper tenants, BuildingMapper buildings) {
        this.meters = meters; this.readings = readings;
        this.contracts = contracts; this.tenants = tenants; this.buildings = buildings;
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
        Map<Integer, MeterReading> readByMeter = readingsByMeter(ym);
        Map<Integer, String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));

        List<MeterBindingDTO.Row> rows = new ArrayList<>();
        Map<String, Integer> counts = new HashMap<>();
        Map<String, Integer> manual = new LinkedHashMap<>();
        BUCKETS.forEach(b -> manual.put(b, 0));
        int missing = 0;

        for (Meter m : meters.selectFiltered(null, null)) {
            // 非租户表(含 park 园区自担)不参与绑定;已停用表本月不在服务中,不进待核/待绑定分母(V68)
            if (!"tenant".equals(m.getOwnership()) || MeterService.retired(m, ym)) continue;
            boolean hasReading = usable(readByMeter.get(m.getId()));
            if (!hasReading) missing++;

            String status; String bucket = null; Contract chosen = null; List<Contract> cands = List.of();
            if (m.getTenantId() == null) {
                status = meaningless(m.getTenantName()) ? "placeholder" : "pending";
            } else if (m.getContractId() != null) {   // 规则1:override 直接采用,确定不覆盖才警示
                chosen = byId.get(m.getContractId());
                status = staleFor(chosen, first, last) ? "override_stale" : "override";
            } else {
                List<Contract> fam = famContracts.getOrDefault(
                    root.getOrDefault(m.getTenantId(), m.getTenantId()), List.of());
                List<Contract> covering = fam.stream().filter(c -> covers(c, first, last)).toList();
                if (covering.size() == 1) { status = "auto"; chosen = covering.get(0); }          // 规则3
                else if (covering.size() > 1) {                                                   // 规则4:楼栋对位
                    List<Contract> bld = covering.stream()
                        .filter(c -> Objects.equals(c.getBuildingId(), m.getBuildingId())).toList();
                    if (bld.size() == 1) { status = "auto_bld"; chosen = bld.get(0); }
                    else { status = "manual"; bucket = bld.isEmpty() ? "bld_mismatch" : "ambiguous"; cands = covering; }
                } else {                                                                          // 规则5:分桶
                    List<Contract> noDates = fam.stream()
                        .filter(c -> c.getStartDate() == null || c.getEndDate() == null).toList();
                    status = "manual";
                    if (!noDates.isEmpty()) { bucket = "date_missing"; cands = noDates; }   // 唯一时 UI 一键确认=写 override
                    else bucket = "no_contract";   // 含「有日期但不覆盖该月」:该月无可用合同
                }
            }
            if ("manual".equals(status)) manual.merge(bucket, 1, Integer::sum);
            else counts.merge(status, 1, Integer::sum);
            Integer cid = chosen != null ? chosen.getId() : m.getContractId();
            rows.add(new MeterBindingDTO.Row(m.getId(), status, bucket,
                "pending".equals(status) || "placeholder".equals(status) ? null : cid,
                chosen == null ? null : chosen.getContractNo(),
                cands.stream().map(c -> new MeterBindingDTO.Candidate(c.getId(), c.getContractNo(),
                    bName.get(c.getBuildingId()), c.getStartDate(), c.getEndDate())).toList(),
                hasReading));
        }
        MeterBindingDTO.Summary summary = new MeterBindingDTO.Summary(
            counts.getOrDefault("auto", 0), counts.getOrDefault("auto_bld", 0),
            counts.getOrDefault("override", 0), counts.getOrDefault("override_stale", 0),
            manual, counts.getOrDefault("pending", 0), counts.getOrDefault("placeholder", 0), missing);
        return new MeterBindingDTO(summary, rows);
    }

    // ── 人工绑定/解绑(写 override;§3) ──
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
    @Transactional
    public AutoLinkResultDTO autoLinkByName() {
        Map<String, List<Tenant>> byName = new HashMap<>();
        for (Tenant t : tenants.selectList(null))
            for (String n : TenantService.matchNames(t))
                byName.computeIfAbsent(n, k -> new ArrayList<>()).add(t);
        int linked = 0, skipped = 0;
        for (Meter m : meters.selectList(null)) {
            if (!"tenant".equals(m.getOwnership()) || m.getTenantId() != null
                || meaningless(m.getTenantName())) continue;   // 仅待核表
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
                || MeterService.retired(m, ym)) continue;   // 停用表不进计费输入面(V68)
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

    // override 失效:仅起止齐全且确定不覆盖才警示(缺日期无法断言,不标——缺口由 date_missing 报表追)
    private static boolean staleFor(Contract c, LocalDate first, LocalDate last) {
        return c == null || (c.getStartDate() != null && c.getEndDate() != null
            && (c.getStartDate().isAfter(last) || c.getEndDate().isBefore(first)));
    }

    private static BigDecimal nsum(BigDecimal a, BigDecimal b) {
        return b == null ? a : a == null ? b : a.add(b);
    }
}
