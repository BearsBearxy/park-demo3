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

    private final AllocRuleMapper rules;
    private final AllocRuleMeterMapper ruleMeters;
    private final AllocRuleMemberMapper ruleMembers;
    private final AllocCfgMapper cfgs;
    private final AllocResultMapper results;
    private final MeterMapper meters;
    private final MeterReadingMapper readings;
    private final TenantMapper tenants;
    private final BuildingMapper buildings;
    private final ContractMapper contracts;
    private final ElecCostEntryMapper elecEntries;   // 互认提示行只读(单向:P-B 永不写 elec_cost)

    public AllocService(AllocRuleMapper rules, AllocRuleMeterMapper ruleMeters, AllocRuleMemberMapper ruleMembers,
                        AllocCfgMapper cfgs, AllocResultMapper results, MeterMapper meters,
                        MeterReadingMapper readings, TenantMapper tenants, BuildingMapper buildings,
                        ContractMapper contracts, ElecCostEntryMapper elecEntries) {
        this.rules = rules; this.ruleMeters = ruleMeters; this.ruleMembers = ruleMembers;
        this.cfgs = cfgs; this.results = results; this.meters = meters; this.readings = readings;
        this.tenants = tenants; this.buildings = buildings; this.contracts = contracts;
        this.elecEntries = elecEntries;
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

    // 收取租户损耗率 I(§2.4.4):常例 I=−ROUND((E−G−adjQty)/C,4)+adjRate;
    // 分表>总表特例(E>0,一期B座)只计公共电份额 I=ROUND(G/C,4)+adjRate。C=总表量,E=分表Σ−总表。
    public static BigDecimal tenantLossRate(BigDecimal lossQty, BigDecimal shareQty, BigDecimal adjQty,
                                            BigDecimal adjRate, BigDecimal headQty) {
        if (headQty == null || headQty.signum() == 0) return null;
        BigDecimal base = lossQty.signum() > 0
            ? r4(nz(shareQty).divide(headQty, 10, RoundingMode.HALF_UP))
            : r4(lossQty.subtract(nz(shareQty)).subtract(nz(adjQty))
                .divide(headQty, 10, RoundingMode.HALF_UP)).negate();
        return base.add(nz(adjRate));
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

    // ── 年份(数据驱动:抄表年∪结果年——有读数即可生成,有结果即可回看) ──
    public List<Integer> years() {
        Set<Integer> ys = new TreeSet<>(readings.selectDistinctYears());
        ys.addAll(results.selectDistinctYears());
        return new ArrayList<>(ys);
    }

    // ── 规则 CRUD(整体保存:rule+meterIds+members 随行覆盖) ──
    public List<AllocRuleDTO> ruleList(String zone) {
        Map<Integer, List<Integer>> mByRule = ruleMeters.selectList(null).stream()
            .collect(groupingBy(AllocRuleMeter::getRuleId,
                java.util.stream.Collectors.mapping(AllocRuleMeter::getMeterId, java.util.stream.Collectors.toList())));
        Map<Integer, List<AllocRuleMember>> memByRule = ruleMembers.selectList(null).stream()
            .collect(groupingBy(AllocRuleMember::getRuleId));
        return rules.selectByZone(zone).stream()
            .map(r -> toDTO(r, mByRule.getOrDefault(r.getId(), List.of()),
                memByRule.getOrDefault(r.getId(), List.of()))).toList();
    }

    @Transactional
    public AllocRuleDTO createRule(AllocRuleReq req) {
        validateRule(req);
        AllocRule r = new AllocRule();
        apply(r, req);
        r.setSortNo(rules.maxSortNo() + 1);
        rules.insert(r);
        saveChildren(r.getId(), req);
        return ruleById(r.getId());
    }

    @Transactional
    public AllocRuleDTO updateRule(Integer id, AllocRuleReq req) {
        AllocRule r = rules.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "规则不存在");
        validateRule(req);
        apply(r, req);
        rules.updateById(r);
        ruleMeters.deleteByRule(id);
        ruleMembers.deleteByRule(id);
        saveChildren(id, req);
        return ruleById(id);
    }

    public void deleteRule(Integer id) {
        if (rules.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "规则不存在");
        if (results.countByRule(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该规则已有分摊结果,不可删除(历史月已快照)");
        rules.deleteById(id);   // 绑定表/受益人 FK 级联删
    }

    private static void validateRule(AllocRuleReq req) {
        if (("area".equals(req.method()) || "floor".equals(req.method()))
                && (req.coefficient() == null || req.coefficient().signum() <= 0))
            throw new BizException(ResultCode.BAD_REQUEST, "按面积/按层规则必须填正系数(面积Σ㎡/层数)");
        if ("direct".equals(req.method()) && (req.members() == null || req.members().size() != 1))
            throw new BizException(ResultCode.BAD_REQUEST, "整笔归户规则受益人必须恰好一户");
    }

    private static void apply(AllocRule r, AllocRuleReq req) {
        r.setZone(req.zone()); r.setName(req.name().trim()); r.setBuildingId(req.buildingId());
        r.setMethod(req.method()); r.setCoefficient(req.coefficient());
        r.setExtraQty(nz(req.extraQty())); r.setFeeKey(req.feeKey());
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note().trim());
    }

    private void saveChildren(Integer ruleId, AllocRuleReq req) {
        for (Integer mid : new LinkedHashSet<>(req.meterIds() == null ? List.<Integer>of() : req.meterIds())) {
            AllocRuleMeter rm = new AllocRuleMeter();
            rm.setRuleId(ruleId); rm.setMeterId(mid);
            ruleMeters.insert(rm);
        }
        // loss 规则无 member(受益人=当月有用电量的全部租户,生成时动态取)
        if ("loss".equals(req.method())) return;
        Set<Integer> seen = new HashSet<>();
        for (AllocMemberDTO m : req.members() == null ? List.<AllocMemberDTO>of() : req.members()) {
            if (m.tenantId() == null || !seen.add(m.tenantId())) continue;
            AllocRuleMember mb = new AllocRuleMember();
            mb.setRuleId(ruleId); mb.setTenantId(m.tenantId()); mb.setWeight(m.weight());
            ruleMembers.insert(mb);
        }
    }

    private AllocRuleDTO ruleById(Integer id) {
        return toDTO(rules.selectById(id), ruleMeters.selectByRule(id).stream().map(AllocRuleMeter::getMeterId).toList(),
            ruleMembers.selectByRule(id));
    }

    private static AllocRuleDTO toDTO(AllocRule r, List<Integer> meterIds, List<AllocRuleMember> mems) {
        return new AllocRuleDTO(r.getId(), r.getZone(), r.getName(), r.getBuildingId(), r.getMethod(),
            r.getCoefficient(), r.getExtraQty(), r.getFeeKey(), r.getNote(), r.getSortNo(), meterIds,
            mems.stream().map(m -> new AllocMemberDTO(m.getTenantId(), m.getWeight())).toList());
    }

    // ── 参数(读=默认行∪当月行原值,解析「月行优先」由读侧完成;写=单行 upsert,value=null 删行回退默认) ──
    public List<AllocCfgDTO> cfgList(String ym) {
        requireYm(ym);
        return cfgs.selectEffective(ym).stream()
            .map(c -> new AllocCfgDTO(c.getId(), c.getScope(), c.getCfgKey(), c.getCfgValue(), c.getAcctMonth(), c.getNote()))
            .toList();
    }

    public void saveCfg(AllocCfgReq req) {
        String month = req.acctMonth() == null ? "" : req.acctMonth().trim();
        AllocCfg row = cfgs.selectByKey(req.scope().trim(), req.cfgKey().trim(), month);
        if (req.value() == null) {
            if (row != null) cfgs.deleteById(row.getId());
            return;
        }
        if (row == null) {
            row = new AllocCfg();
            row.setScope(req.scope().trim()); row.setCfgKey(req.cfgKey().trim()); row.setAcctMonth(month);
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
        List<Contribution> all = computeAll(ctx);

        // (tenant|fee) 聚合(uk 粒度);多规则同费项合并 → rule_id 置空,note 并列规则名
        Map<String, List<Contribution>> byKey = new LinkedHashMap<>();
        for (Contribution c : all) byKey.computeIfAbsent(c.tenantId() + "|" + c.feeKey(), k -> new ArrayList<>()).add(c);

        results.deleteGenByYm(ym);
        Set<String> manualKeys = new HashSet<>();
        for (AllocResult m : results.selectByYm(ym)) manualKeys.add(m.getTenantId() + "|" + m.getFeeKey());

        int rows = 0, manualKept = manualKeys.size();   // 删 gen 后仅剩 manual 行=全部保留
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
            results.insert(r);
            rows++;
            tenantIds.add(first.tenantId());
        }
        // 损耗链会二次派生规则用量,同一「缺抄」可能重复上报 → 去重保序
        return new AllocGenerateResultDTO(rows, tenantIds.size(), manualKept,
            new ArrayList<>(new LinkedHashSet<>(ctx.warnings())));
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
                       List<AllocRule> ruleList, Map<Integer, List<Integer>> meterIdsByRule,
                       Map<Integer, List<AllocRuleMember>> membersByRule,
                       Map<Integer, Building> buildingById, List<String> warnings) {}

    private record Contribution(Integer tenantId, String feeKey, Integer ruleId, String ruleName,
                                BigDecimal qty, BigDecimal amount, BigDecimal rate, BigDecimal price, String note) {}

    // 规则用量(总+分时四段;缺抄表跳过并入 warnings)
    private record RuleUsage(BigDecimal qty, BigDecimal sharp, BigDecimal peak, BigDecimal flat, BigDecimal valley) {}

    private Ctx loadCtx(String ym) {
        Map<Integer, Meter> meterById = new HashMap<>();
        for (Meter m : meters.selectList(null)) meterById.put(m.getId(), m);
        Map<Integer, MeterReading> readingByMeter = new HashMap<>();
        for (MeterReading r : readings.selectByYm(ym)) readingByMeter.put(r.getMeterId(), r);
        // 参数解析:默认行先落,当月行覆盖(月行优先回退默认,ElecCostService.resolveCfg 同规则)
        Map<String, BigDecimal> cfg = new HashMap<>();
        List<AllocCfg> eff = cfgs.selectEffective(ym);
        for (AllocCfg c : eff) if (c.getAcctMonth().isEmpty()) cfg.put(c.getScope() + "|" + c.getCfgKey(), c.getCfgValue());
        for (AllocCfg c : eff) if (!c.getAcctMonth().isEmpty()) cfg.put(c.getScope() + "|" + c.getCfgKey(), c.getCfgValue());
        // 户租赁面积=Σ active 合同 rent_area(V33 面积模型)
        Map<Integer, BigDecimal> areaByTenant = new HashMap<>();
        for (Contract c : contracts.selectList(new QueryWrapper<Contract>().eq("status", "active")))
            if (c.getTenantId() != null && c.getRentArea() != null)
                areaByTenant.merge(c.getTenantId(), c.getRentArea(), BigDecimal::add);
        Map<Integer, List<Integer>> meterIdsByRule = ruleMeters.selectList(null).stream()
            .collect(groupingBy(AllocRuleMeter::getRuleId,
                java.util.stream.Collectors.mapping(AllocRuleMeter::getMeterId, java.util.stream.Collectors.toList())));
        Map<Integer, List<AllocRuleMember>> membersByRule = ruleMembers.selectList(null).stream()
            .collect(groupingBy(AllocRuleMember::getRuleId));
        Map<Integer, Building> buildingById = new HashMap<>();
        for (Building b : buildings.selectList(null)) buildingById.put(b.getId(), b);
        return new Ctx(ym, meterById, readingByMeter, cfg, areaByTenant,
            rules.selectByZone(null), meterIdsByRule, membersByRule, buildingById, new ArrayList<>());
    }

    private static BigDecimal cfgVal(Ctx ctx, String scope, String key) { return ctx.cfg().get(scope + "|" + key); }

    private RuleUsage ruleUsage(AllocRule rule, Ctx ctx) {
        BigDecimal qty = BigDecimal.ZERO, sharp = BigDecimal.ZERO, peak = BigDecimal.ZERO,
            flat = BigDecimal.ZERO, valley = BigDecimal.ZERO;
        boolean any = false;
        for (Integer mid : ctx.meterIdsByRule().getOrDefault(rule.getId(), List.of())) {
            Meter m = ctx.meterById().get(mid);
            MeterReading r = ctx.readingByMeter().get(mid);
            BigDecimal u = r == null ? null : MeterService.usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap());
            if (u == null) {   // 缺读数=跳过并标缺抄,不硬算(§2.1)
                ctx.warnings().add("规则「" + rule.getName() + "」绑定表『" + (m == null ? "#" + mid : m.getName()) + "』" + ctx.ym() + " 缺抄");
                continue;
            }
            any = true;
            qty = qty.add(u);
            sharp = sharp.add(nz(MeterService.usage(r.getPrevSharp(), r.getCurrSharp(), r.getFactorSnap())));
            peak = peak.add(nz(MeterService.usage(r.getPrevPeak(), r.getCurrPeak(), r.getFactorSnap())));
            flat = flat.add(nz(MeterService.usage(r.getPrevFlat(), r.getCurrFlat(), r.getFactorSnap())));
            valley = valley.add(nz(MeterService.usage(r.getPrevValley(), r.getCurrValley(), r.getFactorSnap())));
        }
        return any ? new RuleUsage(qty, sharp, peak, flat, valley) : null;
    }

    // 规则全额成本(§2.3 AD 口径):p1=ROUND((用量+加度)×单价,2);p2=分时金额 W(无分时段回退 平价×总量)
    private BigDecimal ruleCostAmount(AllocRule rule, RuleUsage u, Ctx ctx) {
        if ("p1".equals(rule.getZone())) {
            BigDecimal price = cfgVal(ctx, "p1", "price_flat");
            if (price == null) { ctx.warnings().add("缺参数 p1.price_flat,规则「" + rule.getName() + "」跳过"); return null; }
            return r2(u.qty().add(nz(rule.getExtraQty())).multiply(price));
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
        return r2(u.qty().add(nz(rule.getExtraQty())).multiply(pNorm));
    }

    // 全部规则(非 loss)+损耗链 → 户级贡献清单(生成/抽屉/对账共用同一计算体,口径全等由结构保证)
    private List<Contribution> computeAll(Ctx ctx) {
        List<Contribution> out = new ArrayList<>();
        for (AllocRule rule : ctx.ruleList()) {
            if ("loss".equals(rule.getMethod()) || "share_water".equals(rule.getFeeKey())) continue;   // loss 走损耗链;水占位不生成
            RuleUsage u = ruleUsage(rule, ctx);
            if (u == null) continue;
            BigDecimal cost = ruleCostAmount(rule, u, ctx);
            if (cost == null) continue;
            out.addAll(memberAmounts(rule, u, cost, ctx));
        }
        out.addAll(lossContributions(ctx));
        return out;
    }

    // 四类方法金额化(§2.2)——户级
    private List<Contribution> memberAmounts(AllocRule rule, RuleUsage u, BigDecimal cost, Ctx ctx) {
        List<AllocRuleMember> mems = ctx.membersByRule().getOrDefault(rule.getId(), List.of());
        List<Contribution> out = new ArrayList<>();
        BigDecimal effPrice = u.qty().signum() == 0 ? null : cost.divide(u.qty(), 6, RoundingMode.HALF_UP);
        switch (rule.getMethod()) {
            case "direct" -> {   // 户金额=全额整笔归户(AC14 型)
                if (mems.isEmpty()) { ctx.warnings().add("规则「" + rule.getName() + "」无受益人,跳过"); break; }
                out.add(new Contribution(mems.get(0).getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                    u.qty(), cost, null, effPrice, null));
            }
            case "area" -> {     // 标准=ROUND(全额/coef,2) 元/㎡;户金额=ROUND(标准×户租赁面积,2)(AC15/F8 型)
                BigDecimal std = unitStd(cost, rule.getCoefficient());   // 全额已含价,两期同式
                if (std == null) break;
                for (AllocRuleMember m : mems) {
                    BigDecimal area = ctx.areaByTenant().get(m.getTenantId());
                    if (area == null || area.signum() == 0) {
                        ctx.warnings().add("规则「" + rule.getName() + "」受益租户#" + m.getTenantId() + " 无租赁面积(active 合同),跳过");
                        continue;
                    }
                    BigDecimal qtyShare = rule.getCoefficient().signum() == 0 ? null
                        : r2(u.qty().multiply(area).divide(rule.getCoefficient(), 10, RoundingMode.HALF_UP));
                    out.add(new Contribution(m.getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                        qtyShare, r2(std.multiply(area)), std, effPrice, null));
                }
            }
            case "floor" -> {    // 元/层=ROUND((全额含加度)/层数,2);户金额=元/层×weight;NULL 权重层内按面积二拆(§2.2)
                BigDecimal perFloor = unitStd(cost, rule.getCoefficient());
                if (perFloor == null) break;
                List<AllocRuleMember> nulls = mems.stream().filter(m -> m.getWeight() == null).toList();
                BigDecimal nullAreaSum = nulls.stream().map(m -> nz(ctx.areaByTenant().get(m.getTenantId())))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
                for (AllocRuleMember m : mems) {
                    BigDecimal amt;
                    BigDecimal w = m.getWeight();
                    if (w != null) amt = r2(perFloor.multiply(w));                       // 每户一份/对半(H48/F63 型)
                    else amt = floorAreaSplit(perFloor, nullAreaSum, nz(ctx.areaByTenant().get(m.getTenantId())));   // H55 型
                    if (amt == null) {
                        ctx.warnings().add("规则「" + rule.getName() + "」NULL 权重户面积Σ=0,层内二拆跳过");
                        continue;
                    }
                    BigDecimal qtyShare = cost.signum() == 0 ? null
                        : r2(u.qty().multiply(amt).divide(cost, 10, RoundingMode.HALF_UP));
                    out.add(new Contribution(m.getTenantId(), rule.getFeeKey(), rule.getId(), rule.getName(),
                        qtyShare, amt, perFloor, effPrice, null));
                }
            }
            default -> { }
        }
        return out;
    }

    // ── 损耗链(§2.4):楼栋(组)级 总表vs分表 残差 → 收取率 I → 户损耗费=户用电×I×price_loss ──
    // 组定义:默认每楼栋自成组(有 infra 总表);共用总表(二期二/三/四车间)用 alloc_cfg
    // scope=building:{id}, key=loss_head, value=头栋 building_id 归组——加行不加列。
    private record LossGroup(Integer headBuildingId, String zone, List<Integer> buildingIds,
                             BigDecimal headQty, BigDecimal subQty) {}

    private List<LossGroup> lossGroups(Ctx ctx) {
        // 楼栋 → head 楼栋(loss_head 参数,默认自身)
        Map<Integer, Integer> headOf = new HashMap<>();
        Map<Integer, BigDecimal> headQty = new HashMap<>(), subQty = new HashMap<>();
        Map<Integer, String> zoneOf = new HashMap<>();
        Map<Integer, List<Integer>> memberBuildings = new LinkedHashMap<>();
        for (Meter m : ctx.meterById().values()) {
            if (m.getBuildingId() == null || !"elec".equals(m.getKind()) || "dorm".equals(m.getZone())) continue;
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
            if (u == null) continue;
            if ("infra".equals(m.getOwnership())) headQty.merge(head, u, BigDecimal::add);
            else if ("tenant".equals(m.getOwnership()) || "share".equals(m.getOwnership()))
                subQty.merge(head, u, BigDecimal::add);
        }
        List<LossGroup> out = new ArrayList<>();
        for (Map.Entry<Integer, List<Integer>> e : memberBuildings.entrySet()) {
            BigDecimal c = headQty.get(e.getKey());
            if (c == null) continue;   // 无总表读数=该组本月不出损耗率(抄表屏黄标提示)
            out.add(new LossGroup(e.getKey(), zoneOf.get(e.getKey()), e.getValue(),
                c, nz(subQty.get(e.getKey()))));
        }
        return out;
    }

    // 一期分摊用电度数 G=ROUND(园区级公共电(loss 规则用量Σ)/park_share_div,2)(86.8 度/栋);二期无此项=0
    private BigDecimal shareQtyOf(String zone, Ctx ctx) {
        if (!"p1".equals(zone)) return BigDecimal.ZERO;
        BigDecimal div = cfgVal(ctx, "p1", "park_share_div");
        if (div == null || div.signum() == 0) return BigDecimal.ZERO;
        BigDecimal sum = BigDecimal.ZERO;
        for (AllocRule rule : ctx.ruleList()) {
            if (!"loss".equals(rule.getMethod()) || !"p1".equals(rule.getZone())) continue;
            RuleUsage u = ruleUsage(rule, ctx);
            if (u != null) sum = sum.add(u.qty());
        }
        return r2(sum.divide(div, 10, RoundingMode.HALF_UP));
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
            for (Map.Entry<Integer, BigDecimal> e : usageByTenant.entrySet()) {
                out.add(new Contribution(e.getKey(), FEE_LOSS, null, null, r2(e.getValue()),
                    lossFee(e.getValue(), rate, priceLoss), rate, priceLoss, null));
            }
        }
        return out;
    }

    private BigDecimal groupRate(LossGroup g, Ctx ctx) {
        BigDecimal lossQty = g.subQty().subtract(g.headQty());   // E=分表Σ−总表(负=有损耗)
        BigDecimal adjQty = BigDecimal.ZERO;
        for (Integer bid : g.buildingIds()) adjQty = adjQty.add(nz(cfgVal(ctx, "building:" + bid, "loss_adj_qty")));
        BigDecimal adjRate = nz(cfgVal(ctx, "building:" + g.headBuildingId(), "loss_adj_rate"));
        return tenantLossRate(lossQty, shareQtyOf(g.zone(), ctx), adjQty, adjRate, g.headQty());
    }

    private List<AllocLossRowDTO> lossTable(Ctx ctx) {
        List<AllocLossRowDTO> out = new ArrayList<>();
        for (LossGroup g : lossGroups(ctx)) {
            BigDecimal lossQty = g.subQty().subtract(g.headQty());
            BigDecimal rawRate = g.headQty().signum() == 0 ? null
                : r4(lossQty.divide(g.headQty(), 10, RoundingMode.HALF_UP));
            BigDecimal adjQty = BigDecimal.ZERO;
            for (Integer bid : g.buildingIds()) adjQty = adjQty.add(nz(cfgVal(ctx, "building:" + bid, "loss_adj_qty")));
            String name = g.buildingIds().stream()
                .map(bid -> { Building b = ctx.buildingById().get(bid); return b == null ? "#" + bid : b.getName(); })
                .reduce((a, b) -> a + "+" + b).orElse("#" + g.headBuildingId());
            out.add(new AllocLossRowDTO(g.zone(), g.headBuildingId(), name,
                r2(g.headQty()), r2(g.subQty()), r2(lossQty), rawRate,
                shareQtyOf(g.zone(), ctx), r2(adjQty),
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

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式非法(应为 YYYY-MM)");
    }
}
