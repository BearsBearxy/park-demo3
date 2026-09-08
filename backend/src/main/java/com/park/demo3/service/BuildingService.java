package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import com.park.demo3.security.NoReviewGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal; import java.math.RoundingMode;
import java.util.*; import java.util.stream.Collectors;

@Service
public class BuildingService {
    private final BuildingMapper buildings; private final UnitMapper units; private final ContractMapper contracts;
    private final TenantMapper tenantMapper;
    private final ContractUnitMapper contractUnits;   // V58 附加单元关联(主单元在 contract.unit_id)
    private final ContractBillingTermMapper terms;    // S15 面积派生:unit.area 全库为 0,面积改由计费行派生
    private final BillingTermUnitMapper termUnits;    // S15 面积派生:行级绑定优先口径(V91)
    private final ParamService params;   // 面积是计费口径,改它要留痕(RBAC-SPEC §7.1)

    public BuildingService(BuildingMapper b, UnitMapper u, ContractMapper c, TenantMapper t, ContractUnitMapper cu,
                           ContractBillingTermMapper tm, BillingTermUnitMapper btu, ParamService params) {
        buildings=b; units=u; contracts=c; tenantMapper=t; contractUnits=cu; terms=tm; termUnits=btu;
        this.params = params;
    }

    /** unit_id → 关联合同 id 集(附加单元);占用判定=主单元 ∪ 附加关联(V58)。 */
    private Map<Integer, Set<Integer>> linksByUnit() {
        return contractUnits.selectList(null).stream().collect(Collectors.groupingBy(
            ContractUnit::getUnitId, Collectors.mapping(ContractUnit::getContractId, Collectors.toSet())));
    }
    static boolean occupies(Contract c, Integer unitId, Map<Integer, Set<Integer>> links) {
        return Objects.equals(c.getUnitId(), unitId)
            || (c.getId() != null && links.getOrDefault(unitId, Set.of()).contains(c.getId()));
    }

    static final Map<Integer,String> PHASE = Map.of(1,"一期",2,"二期",3,"三期",4,"宿舍");
    static String kind(int phase) { return phase == 4 ? "宿舍" : "厂房"; }
    static final Set<String> RENT = Set.of("active","expiring");            // 计租相关

    /** 单元占用态的**唯一判据**(METRIC-SOURCE-SPEC §1.1 登记册):
     *  取该单元合同的展示态(§5.1 日期派生,到期不再占用),active→occupied/expiring→expiring/draft→reserved,无→vacant */
    static String unitStatus(Integer unitId, List<Contract> cs, Map<Integer, Set<Integer>> links) {
        String best = "vacant";
        for (Contract c : cs) {
            if (!occupies(c, unitId, links)) continue;
            switch (ContractService.effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate())) {
                case "active": return "occupied";
                case "expiring": best = "expiring"; break;
                case "draft": if (best.equals("vacant")) best = "reserved"; break;
                default: break;
            }
        }
        return best;
    }

    /** S15 单元派生面积:unit.area 全库 373 行皆 0(数据缺口),显示口径改由合同计费行派生。
     *  绑定优先:在租(active/expiring)合同的建筑类租金行经 billing_term_unit 绑到该单元
     *  → Σ(行 area ÷ 该行绑定单元数);renewed/terminated 旧链绑定不计(防续签链翻倍)。
     *  无绑定回退:该单元为主/附加单元的在租合同,非宿舍租金行面积(三元去重) ÷ 合同单元数均摊;再无则 0。 */
    Map<Integer, BigDecimal> derivedUnitAreas(List<Contract> allCt, Map<Integer, Set<Integer>> links) {
        Map<Integer, Contract> rentCs = new HashMap<>();
        for (Contract c : allCt)
            if (c.getId() != null
                && RENT.contains(ContractService.effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate())))
                rentCs.put(c.getId(), c);
        List<ContractBillingTerm> allTerms = terms.selectList(null);
        Map<Integer, ContractBillingTerm> termById = new HashMap<>();
        for (ContractBillingTerm t : allTerms) termById.put(t.getId(), t);
        List<BillingTermUnit> binds = termUnits.selectList(null);
        Map<Integer, Long> unitCntByTerm = binds.stream()
            .collect(Collectors.groupingBy(BillingTermUnit::getTermId, Collectors.counting()));
        Map<Integer, BigDecimal> area = new HashMap<>();
        Set<Integer> bound = new HashSet<>();
        for (BillingTermUnit bind : binds) {
            ContractBillingTerm t = termById.get(bind.getTermId());
            if (t == null || t.getArea() == null) continue;
            if (!ContractService.BUILDING_RENT_KEYS.contains(t.getFeeKey())) continue;   // mgmt/infra 同面积行不重复计
            if (!rentCs.containsKey(t.getContractId())) continue;
            bound.add(bind.getUnitId());
            area.merge(bind.getUnitId(),
                t.getArea().divide(BigDecimal.valueOf(unitCntByTerm.get(t.getId())), 2, RoundingMode.HALF_UP),
                BigDecimal::add);
        }
        // 回退(S15-b 型匹配):合同级面积按 单元所在栋的类型 分路均摊——宿舍单元吃宿舍行Σ、
        // 非宿舍单元吃非宿舍行Σ(混装合同不再把厂房面积摊进宿舍间,汤周杰630室曾被摊1554㎡)。
        // 有绑定的单元以绑定为准,不叠加。
        Map<Integer, List<ContractBillingTerm>> termsByContract = allTerms.stream()
            .collect(Collectors.groupingBy(ContractBillingTerm::getContractId));
        Map<Integer, List<Integer>> extrasByContract = new HashMap<>();
        links.forEach((uid, cids) -> cids.forEach(cid ->
            extrasByContract.computeIfAbsent(cid, k -> new ArrayList<>()).add(uid)));
        Map<Integer, Boolean> dormUnit = new HashMap<>();   // unitId → 所在栋是否宿舍(phase=4)
        Map<Integer, Building> bById = new HashMap<>();
        for (Building b : buildings.selectList(null)) bById.put(b.getId(), b);
        for (Unit u : units.selectList(null)) {
            Building b = u.getBuildingId() == null ? null : bById.get(u.getBuildingId());
            dormUnit.put(u.getId(), b != null && b.getPhase() != null && b.getPhase() == 4);
        }
        for (Contract c : rentCs.values()) {
            List<Integer> cus = new ArrayList<>();
            if (c.getUnitId() != null) cus.add(c.getUnitId());
            for (Integer uid : extrasByContract.getOrDefault(c.getId(), List.of()))
                if (!cus.contains(uid)) cus.add(uid);
            if (cus.isEmpty()) continue;
            List<ContractBillingTerm> rows = termsByContract.getOrDefault(c.getId(), List.of());
            BigDecimal nondorm = ContractService.dedupAreaSum(rows, ContractService.NONDORM_RENT_KEYS);
            BigDecimal dorm = ContractService.dedupAreaSum(rows, Set.of("rent_dorm"));
            List<Integer> dormUs = cus.stream().filter(u -> Boolean.TRUE.equals(dormUnit.get(u))).toList();
            List<Integer> nonDormUs = cus.stream().filter(u -> !Boolean.TRUE.equals(dormUnit.get(u))).toList();
            // 严格型匹配:没有同类单元的行不摊(宁缺勿错——错配合同的厂房面积不落宿舍间,反之亦然)
            if (nondorm.signum() != 0 && !nonDormUs.isEmpty()) {
                BigDecimal share = nondorm.divide(BigDecimal.valueOf(nonDormUs.size()), 2, RoundingMode.HALF_UP);
                for (Integer uid : nonDormUs) if (!bound.contains(uid)) area.merge(uid, share, BigDecimal::add);
            }
            if (dorm.signum() != 0 && !dormUs.isEmpty()) {
                BigDecimal share = dorm.divide(BigDecimal.valueOf(dormUs.size()), 2, RoundingMode.HALF_UP);
                for (Integer uid : dormUs) if (!bound.contains(uid)) area.merge(uid, share, BigDecimal::add);
            }
        }
        return area;
    }

    /** 出租率的唯一判据(METRIC-SOURCE-SPEC §1/§3):分母缺失或 ≤0、分子>分母(数据自相矛盾)→ null=「算不出来」。
     *  禁止用 0 兼表「真的 0%」与「没法算」;更禁止 Math.min 钳位——原来全园分子>分母被钳成 100%,
     *  同屏并存「全园 100%」与「每栋 0%」与「空置 173/373」,钳出来的假数比报错难发现得多。 */
    static Double occRateOf(BigDecimal leased, BigDecimal rentable) {
        if (rentable == null || rentable.signum() <= 0) return null;
        if (leased == null || leased.compareTo(rentable) > 0) return null;
        return leased.divide(rentable, 4, RoundingMode.HALF_UP)
            .multiply(BigDecimal.valueOf(1000)).setScale(0, RoundingMode.HALF_UP).doubleValue() / 10.0;
    }

    BuildingDTO toDTO(Building b, List<Unit> us, List<Contract> cs, Map<Integer, Set<Integer>> links,
                      Map<Integer, BigDecimal> unitAreas) {
        boolean stopped = b.getStatus() == 0;
        int occ=0, vac=0, exp=0, rsv=0; BigDecimal leased = BigDecimal.ZERO;
        for (Unit u : us) {
            String st = unitStatus(u.getId(), cs, links);
            // S15:「在租面积」= Σ被占单元的合同派生面积(unit.area 全 0,不再可用)
            BigDecimal ua = unitAreas.getOrDefault(u.getId(), BigDecimal.ZERO);
            switch (st) {
                case "occupied": occ++; leased = leased.add(ua); break;
                case "expiring": exp++; occ++; leased = leased.add(ua); break;
                case "reserved": rsv++; leased = leased.add(ua); break;
                default: vac++;
            }
        }
        Double occRate = stopped ? null : occRateOf(leased, b.getRentableArea());   // 停用栋前端渲染「停用」,不需要百分比
        // V59:整体承租(master_lease)与散户空间重叠 → 楼栋卡月租金/户数/面积汇总均排除,防双算
        // 状态取展示态(日期派生):到期合同不再计入在租金额/户数
        // S15:金额/户数/面积汇总仍按主栋合同(跨栋附加单元只在目标栋显示占用,不得双算钱)
        List<Contract> retail = cs.stream()
            .filter(c -> Objects.equals(c.getBuildingId(), b.getId()))
            .filter(c -> RENT.contains(ContractService.effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate())))
            .filter(c -> !"master_lease".equals(c.getKind())).toList();
        BigDecimal monthly = retail.stream()
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        List<Integer> tenantIds = retail.stream()
            .map(Contract::getTenantId).distinct().collect(Collectors.toList());
        // 栋内租户建筑面积汇总=在租合同 building_area 求和(V33 字段,空按 0;只读展示)
        BigDecimal tenantBArea = retail.stream()
            .map(Contract::getBuildingArea).filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new BuildingDTO(b.getId(), b.getName(), b.getPhase(), PHASE.get(b.getPhase()), b.getZone(), kind(b.getPhase()),
            b.getFloorCount(), b.getTotalArea(), b.getRentableArea(), b.getStatus(),
            us.size(), occ, vac, exp, rsv, leased, occRate, monthly, tenantIds, tenantBArea);
    }

    public List<BuildingDTO> list() {
        List<Building> bs = buildings.selectList(null);
        List<Unit> allUnits = units.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer, Set<Integer>> links = linksByUnit();
        Map<Integer, BigDecimal> unitAreas = derivedUnitAreas(allCt, links);
        Map<Integer,List<Unit>> uByB = allUnits.stream().collect(Collectors.groupingBy(Unit::getBuildingId));
        Map<Integer,List<Contract>> cByB = allCt.stream().collect(Collectors.groupingBy(Contract::getBuildingId));
        // S15:楼栋合同集 = 主栋 ∪ 附加单元所在栋(跨栋附加单元在目标栋显示占用)
        Map<Integer,Integer> bOfUnit = new HashMap<>();
        for (Unit u : allUnits) if (u.getBuildingId() != null) bOfUnit.put(u.getId(), u.getBuildingId());
        Map<Integer,Contract> cById = new HashMap<>();
        for (Contract c : allCt) if (c.getId() != null) cById.put(c.getId(), c);
        links.forEach((uid, cids) -> {
            Integer tb = bOfUnit.get(uid);
            if (tb == null) return;
            for (Integer cid : cids) {
                Contract c = cById.get(cid);
                if (c == null || Objects.equals(c.getBuildingId(), tb)) continue;
                List<Contract> l = cByB.computeIfAbsent(tb, k -> new ArrayList<>());
                if (!l.contains(c)) l.add(c);
            }
        });
        return bs.stream().map(b -> toDTO(b,
            uByB.getOrDefault(b.getId(), List.of()), cByB.getOrDefault(b.getId(), List.of()), links, unitAreas)).toList();
    }

    public BuildingDetailDTO detail(Integer id) {
        Building b = buildings.selectById(id);
        if (b == null) throw new com.park.demo3.common.BizException(com.park.demo3.common.ResultCode.NOT_FOUND);
        List<Unit> us = units.selectByBuildingId(id);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer, Set<Integer>> links = linksByUnit();
        Map<Integer, BigDecimal> unitAreas = derivedUnitAreas(allCt, links);
        // S15:合同集 = 主栋 ∪ 跨栋附加单元挂进本栋的合同(宿舍527式占用要显示)
        Set<Integer> crossCids = new HashSet<>();
        for (Unit u : us) crossCids.addAll(links.getOrDefault(u.getId(), Set.of()));
        List<Contract> cs = allCt.stream()
            .filter(c -> Objects.equals(c.getBuildingId(), id) || crossCids.contains(c.getId())).toList();
        BuildingDTO dto = toDTO(b, us, cs, links, unitAreas);
        List<UnitDTO> unitDTOs = us.stream().map(u -> toUnitDTO(u, cs, links, unitAreas)).toList();
        return new BuildingDetailDTO(dto, unitDTOs);
    }

    /** detail 同款单元 DTO 组装(status/租户由该楼栋合同派生),单元 CRUD 回包复用 */
    UnitDTO toUnitDTO(Unit u, List<Contract> cs, Map<Integer, Set<Integer>> links,
                      Map<Integer, BigDecimal> unitAreas) {
        String st = unitStatus(u.getId(), cs, links);
        Contract c = cs.stream()
            .filter(x -> occupies(x, u.getId(), links))
            .filter(x -> Set.of("active","expiring","draft")
                .contains(ContractService.effectiveStatus(x.getStatus(), x.getStartDate(), x.getEndDate())))
            .min(Comparator.comparing(x -> switch (ContractService.effectiveStatus(x.getStatus(), x.getStartDate(), x.getEndDate())) {
                case "active" -> 0; case "expiring" -> 1; default -> 2;
            })).orElse(null);
        Tenant t = c != null ? tenantMapper.selectById(c.getTenantId()) : null;
        // S15-b 跨栋徽章:占用合同主楼栋非本栋(经附加单元挂入)时点亮,并带主栋名
        boolean cross = c != null && u.getBuildingId() != null
            && !Objects.equals(c.getBuildingId(), u.getBuildingId());
        Building home = cross ? buildings.selectById(c.getBuildingId()) : null;
        return new UnitDTO(
            u.getId(), u.getFloor(), u.getUnitNo(), u.getArea(),
            unitAreas.getOrDefault(u.getId(), BigDecimal.ZERO),   // S15 合同派生面积(unit.area 全 0)
            st,
            t != null ? t.getId() : null,
            t != null ? t.getCompanyName() : null,
            t != null ? t.getCompanyName() : null,
            t != null ? t.getBusinessType() : null,
            c != null ? c.getContractNo() : null,
            c != null ? c.getMonthlyRent() : null,
            cross ? Boolean.TRUE : null,
            home != null ? home.getName() : null
        );
    }

    // ─── 楼栋/单元六个写口为什么都不进审核(2026-09-09 逐条过数据流) ──────────────
    // building 与 unit 两张表都没有 ym 列。它们里面**确实有两列进分摊引擎** —— building.zone
    // 被 inForceByZone 用来切期别名册,unit.area 是 area 法公摊的分摊基数与 per_sqm_month 租金行
    // 的面积来源 —— 所以理由不能写成「这是主数据」。真正的判据是这两列只被 loadCtx(ym) 读,
    // 而 loadCtx 的写侧调用点只有 AllocService.generate(ym)(已守 ALLOC + ALLOC_LOSS),
    // 其余四个调用点(resultDetail / recon / meterDiff / loss)全是读。改档案只改下一次生成的
    // 结果,已审月落库的 alloc_pool_result / alloc_result 一行不变。
    @NoReviewGuard(reason = "insert building 与可选批量 unit,两张表都无 ym 列;新栋下不可能挂着覆盖历史月的合同,进不了任何已审月的名册与面积基数")
    @Transactional
    public BuildingDTO create(BuildingCreateReq req) {
        if (buildings.selectCount(new QueryWrapper<Building>().eq("name", req.name())) > 0)
            throw new BizException(ResultCode.CONFLICT, "楼栋名称已存在");
        int perFloor = req.perFloor() == null ? 0 : req.perFloor();
        Building b = new Building();
        b.setName(req.name()); b.setPhase(req.phase()); b.setFloorCount(req.floorCount());
        b.setTotalArea(req.totalArea()); b.setRentableArea(req.rentableArea());
        b.setStatus(1); b.setPerFloor(perFloor); b.setRemark(req.remark()); b.setZone(req.zone());
        buildings.insert(b);
        if (perFloor > 0) {
            // unit_no 沿用 V2__seed 惯例: floor*100+seq(101/102…);面积=可租面积均摊 2 位小数,末个单元补差额使合计精确
            int total = req.floorCount() * perFloor;
            BigDecimal each = req.rentableArea().divide(BigDecimal.valueOf(total), 2, RoundingMode.HALF_UP);
            BigDecimal last = req.rentableArea().subtract(each.multiply(BigDecimal.valueOf(total - 1)));
            int n = 0;
            for (int f = 1; f <= req.floorCount(); f++) {
                for (int s = 1; s <= perFloor; s++) {
                    n++;
                    Unit u = new Unit();
                    u.setBuildingId(b.getId()); u.setFloor(f);
                    u.setUnitNo(String.valueOf(f * 100 + s));
                    u.setArea(n == total ? last : each);
                    units.insert(u);
                }
            }
        }
        return toDTO(buildings.selectById(b.getId()), units.selectByBuildingId(b.getId()), List.of(), Map.of(), Map.of());
    }

    @NoReviewGuard(reason = "zone 确实进分摊(inForceByZone 按它切期别名册),但只在 loadCtx(ym) 被读、落库只发生在已守 ALLOC/ALLOC_LOSS 的 generate;building 表无 ym 列,面积两列只进本 service 的占用率派生")
    public BuildingDTO update(Integer id, BuildingUpdateReq req) {
        Building b = buildings.selectById(id);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "楼栋不存在");
        if (buildings.selectCount(new QueryWrapper<Building>().eq("name", req.name()).ne("id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "楼栋名称已存在");
        int maxFloor = units.selectByBuildingId(id).stream().mapToInt(Unit::getFloor).max().orElse(0);
        if (req.floorCount() < maxFloor)
            throw new BizException(ResultCode.CONFLICT, "层数不能小于现有单元的最高楼层");
        b.setName(req.name()); b.setPhase(req.phase()); b.setFloorCount(req.floorCount());
        b.setTotalArea(req.totalArea()); b.setRentableArea(req.rentableArea());
        b.setStatus(req.status()); b.setRemark(req.remark()); b.setZone(req.zone());
        buildings.updateById(b);
        Map<Integer, Set<Integer>> links = linksByUnit();
        return toDTO(buildings.selectById(id), units.selectByBuildingId(id), contracts.selectByBuildingId(id),
            links, derivedUnitAreas(contracts.selectList(null), links));
    }

    // ⚠ reason 2026-09-09 改写过一次。改前写的是「能删掉的楼栋从来没挂过合同」—— 漏了一整条
    //   引用路径:下面那道 409 只查 contract.building_id,而 ContractService.replaceExtraUnits
    //   往 contract_unit 插附加单元时**不校验该单元属于本合同的楼栋**,A 栋的合同可以把 B 栋的
    //   单元当附加单元用(billing_term_unit 同理,行级绑定连合同楼栋都不看)。所以「本栋无合同」
    //   推不出「本栋的单元没被任何合同引用」,理由要写实。
    @NoReviewGuard(reason = "该楼栋下存在任何合同(不论状态,含历史 terminated/renewed)即先 409;本栋单元被别栋合同当附加单元/计费行单元引用的也先 409(见下面第二道)。两道之后能删掉的楼栋,它的单元既没进过任何一个月的名册,也没当过任何一次分摊的面积基数 —— 而 alloc_result / bill_notice_line 本就是按 ym 存的快照,重算那条路由已守 ALLOC/ALLOC_LOSS/BILL_NOTICES 的 generate 独占")
    public void delete(Integer id) {
        if (buildings.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "楼栋不存在");
        if (contracts.selectCount(new QueryWrapper<Contract>().eq("building_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "该楼栋下存在合同,请先处理合同");
        // 第二道:本栋的 unit 被别处引用。unit 随楼栋 ON DELETE CASCADE(V1),而 contract_unit(V58)
        // 与 billing_term_unit(V91)的 unit_id 是 RESTRICT —— 少这一道,用户看到的是 500 而不是
        // 一句能照着做的中文。挡不住任何本来删得掉的楼栋:这两查有行的场景,原先必 500。
        // ⚠ 空集守卫:无单元时 ids 为空,MP 的 in(空集) 生成 `IN ()` 是 SQL 语法错(500)。
        List<Integer> unitIds = units.selectByBuildingId(id).stream().map(Unit::getId).toList();
        if (!unitIds.isEmpty()
            && (contractUnits.selectCount(new QueryWrapper<ContractUnit>().in("unit_id", unitIds)) > 0
             || termUnits.selectCount(new QueryWrapper<BillingTermUnit>().in("unit_id", unitIds)) > 0))
            throw new BizException(ResultCode.CONFLICT,
                "该楼栋的单元被其他楼栋的合同引用(附加单元或计费行绑定),请先解除引用");
        buildings.deleteById(id); // unit 表 FK ON DELETE CASCADE 自动清
    }

    // ─── 单元 CRUD ───────────────────────────────────────────

    /** unitNo 自动编号:该层现有 unitNo 数字惯例取 max+1,无数字则 floor*100+该层现有数+1 */
    private String nextUnitNo(Integer buildingId, int floor) {
        List<Unit> floorUnits = units.selectList(new QueryWrapper<Unit>()
            .eq("building_id", buildingId).eq("floor", floor));
        int max = 0;
        for (Unit u : floorUnits) {
            try { max = Math.max(max, Integer.parseInt(u.getUnitNo())); } catch (NumberFormatException ignored) {}
        }
        return String.valueOf(max > 0 ? max + 1 : floor * 100 + floorUnits.size() + 1);
    }

    private void requireUniqueUnitNo(Integer buildingId, String unitNo, Integer excludeId) {
        QueryWrapper<Unit> q = new QueryWrapper<Unit>().eq("building_id", buildingId).eq("unit_no", unitNo);
        if (excludeId != null) q.ne("id", excludeId);
        if (units.selectCount(q) > 0) throw new BizException(ResultCode.CONFLICT, "单元号已存在");
    }

    private static void requireFloorInRange(int floor, Building b) {
        if (floor > b.getFloorCount())
            throw new BizException(ResultCode.CONFLICT, "楼层超出楼栋层数,请先在编辑楼栋中增加层数");
    }

    @NoReviewGuard(reason = "insert 一行 unit,表无 ym 列,新单元必然无合同;要让它影响某个月的数得先挂一份覆盖那月的合同,而那条路(ContractService)同样改不了已审月的落库行")
    @Transactional
    public UnitDTO createUnit(Integer buildingId, UnitCreateReq req) {
        Building b = buildings.selectById(buildingId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "楼栋不存在");
        requireFloorInRange(req.floor(), b);
        String unitNo = req.unitNo() == null || req.unitNo().isBlank()
            ? nextUnitNo(buildingId, req.floor()) : req.unitNo();
        requireUniqueUnitNo(buildingId, unitNo, null);
        Unit u = new Unit();
        u.setBuildingId(buildingId); u.setFloor(req.floor()); u.setUnitNo(unitNo);
        u.setArea(req.area() == null ? BigDecimal.ZERO : req.area());
        units.insert(u);
        return toUnitDTO(units.selectById(u.getId()), List.of(), Map.of(), Map.of()); // 新单元无合同,必 vacant
    }

    @NoReviewGuard(reason = "unit.area 是计费口径没错,但它只在 loadCtx(ym) 被读、落库只在已守的 generate,方法内注释自己写的也是「下个月该户租金与公摊一起变」;unit 表无 ym 列,改面积另有 params.logUnitAreaChange 留痕")
    public UnitDTO updateUnit(Integer id, UnitUpdateReq req) {
        Unit u = units.selectById(id);
        if (u == null) throw new BizException(ResultCode.NOT_FOUND, "单元不存在");
        requireFloorInRange(req.floor(), buildings.selectById(u.getBuildingId()));
        requireUniqueUnitNo(u.getBuildingId(), req.unitNo(), id);
        // ⚠ 面积是计费口径,不只是档案字段(RBAC-SPEC §5.6/§7.1):unit.area 同时是
        // per_sqm_month 租金计费行的面积来源、以及 area 法公摊池的分摊基数。档案岗"顺手修一个
        // 录错的面积",下个月该户租金与公摊金额一起变,而参数中心看不到任何变更 ——
        // 「面积污染」已经炸过一次(见 demo3_s15_fixes)。所以改面积要留痕。
        java.math.BigDecimal wasArea = u.getArea();
        u.setFloor(req.floor()); u.setUnitNo(req.unitNo()); u.setArea(req.area());
        units.updateById(u);
        boolean areaChanged = wasArea == null
            ? req.area() != null
            : req.area() == null || wasArea.compareTo(req.area()) != 0;
        if (areaChanged) params.logUnitAreaChange(id, u.getUnitNo(), wasArea, req.area());
        Map<Integer, Set<Integer>> links = linksByUnit();
        return toUnitDTO(u, contracts.selectByBuildingId(u.getBuildingId()), links,
            derivedUnitAreas(contracts.selectList(null), links));
    }

    // ⚠ reason 与第三道查询 2026-09-09 一起补的,和上面 delete(楼栋)那条是**同一个洞的两级**:
    //   改前只查 contract.unit_id 与 contract_unit,漏了 billing_term_unit。而 ContractService.saveLines
    //   写计费行时直接拿请求里的 unitIds 插 billing_term_unit,**既不校验该单元属于本合同楼栋,
    //   也不校验它在 contract_unit 里** —— 所以「只被 billing_term_unit 引用」是可达状态,
    //   而 fk_btu_unit(V91)是 RESTRICT,用户看到的是 400「违反完整性约束」而不是能照着做的中文。
    //   楼栋那一级修好时这一级没跟着修,是典型的「只补了点名的那条路径,兄弟调用点还烂着」。
    @NoReviewGuard(reason = "被 contract.unit_id / contract_unit / billing_term_unit 任一引用即先 409;三道之后能删掉的单元从来没被任何合同占用过,也就从来没进过任何一个月的面积基数或名册 —— 而 alloc_result / bill_notice_line 本就是按 ym 存的快照,重算那条路由已守 ALLOC/ALLOC_LOSS/BILL_NOTICES 的 generate 独占")
    public void deleteUnit(Integer id) {
        if (units.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "单元不存在");
        // 三道查的是三条**互相独立**的引用路径,不是一条的三种写法:主单元 / 附加单元 / 计费行绑定。
        // 单个 id 不需要上面 delete 那道空集守卫。
        if (contracts.selectCount(new QueryWrapper<Contract>().eq("unit_id", id)) > 0
            || contractUnits.selectCount(new QueryWrapper<ContractUnit>().eq("unit_id", id)) > 0
            || termUnits.selectCount(new QueryWrapper<BillingTermUnit>().eq("unit_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "单元存在合同记录(主单元/附加单元/计费行绑定),请先处理相关合同");
        units.deleteById(id);
    }

    public BuildingSummaryDTO summary() {
        List<BuildingDTO> all = list();
        int stopped = (int) all.stream().filter(d -> d.status()==0).count();
        BigDecimal rentable = all.stream().map(BuildingDTO::rentableArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        // 占用率仅按启用楼栋(status!=0)计：与单楼栋 toDTO「停用即 occRate=null」口径一致，
        // 否则停用楼栋的已租面积会进入全局分子分母，造成全局与单楼栋口径不一致
        BigDecimal occRentable = all.stream().filter(d -> d.status()!=0).map(BuildingDTO::rentableArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal occLeased = all.stream().filter(d -> d.status()!=0).map(BuildingDTO::leasedArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        Double occ = occRateOf(occLeased, occRentable);   // 与单栋同一函数,不再各写一遍公式
        int vacant = all.stream().mapToInt(BuildingDTO::vacantCount).sum();
        int unitCount = all.stream().mapToInt(BuildingDTO::unitCount).sum();
        return new BuildingSummaryDTO(all.size(), stopped, rentable, occ, vacant, unitCount);
    }
}
