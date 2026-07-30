package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal; import java.math.RoundingMode;
import java.util.*; import java.util.stream.Collectors;

@Service
public class BuildingService {
    private final BuildingMapper buildings; private final UnitMapper units; private final ContractMapper contracts;
    private final TenantMapper tenantMapper;
    private final ContractUnitMapper contractUnits;   // V58 附加单元关联(主单元在 contract.unit_id)
    public BuildingService(BuildingMapper b, UnitMapper u, ContractMapper c, TenantMapper t, ContractUnitMapper cu) {
        buildings=b; units=u; contracts=c; tenantMapper=t; contractUnits=cu;
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

    /** 单元派生状态: 取该单元合同的展示态(§5.1 日期派生,到期不再占用),active→occupied/expiring→expiring/draft→reserved,无→vacant */
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

    BuildingDTO toDTO(Building b, List<Unit> us, List<Contract> cs, Map<Integer, Set<Integer>> links) {
        boolean stopped = b.getStatus() == 0;
        int occ=0, vac=0, exp=0, rsv=0; BigDecimal leased = BigDecimal.ZERO;
        for (Unit u : us) {
            String st = unitStatus(u.getId(), cs, links);
            switch (st) {
                case "occupied": occ++; leased = leased.add(u.getArea()); break;
                case "expiring": exp++; occ++; leased = leased.add(u.getArea()); break;
                case "reserved": rsv++; leased = leased.add(u.getArea()); break;
                default: vac++;
            }
        }
        double occRate = stopped || b.getRentableArea().signum()==0 ? 0.0
            : Math.min(100.0, leased.divide(b.getRentableArea(), 4, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(1000)).setScale(0, RoundingMode.HALF_UP).doubleValue() / 10.0);
        // V59:整体承租(master_lease)与散户空间重叠 → 楼栋卡月租金/户数/面积汇总均排除,防双算
        // 状态取展示态(日期派生):到期合同不再计入在租金额/户数
        List<Contract> retail = cs.stream()
            .filter(c -> RENT.contains(ContractService.effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate())))
            .filter(c -> !"master_lease".equals(c.getKind())).toList();
        BigDecimal monthly = retail.stream()
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        List<Integer> tenantIds = retail.stream()
            .map(Contract::getTenantId).distinct().collect(Collectors.toList());
        // 栋内租户建筑面积汇总=在租合同 building_area 求和(V33 字段,空按 0;只读展示)
        BigDecimal tenantBArea = retail.stream()
            .map(Contract::getBuildingArea).filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new BuildingDTO(b.getId(), b.getName(), b.getPhase(), PHASE.get(b.getPhase()), kind(b.getPhase()),
            b.getFloorCount(), b.getTotalArea(), b.getRentableArea(), b.getStatus(),
            us.size(), occ, vac, exp, rsv, leased, occRate, monthly, tenantIds, tenantBArea);
    }

    public List<BuildingDTO> list() {
        List<Building> bs = buildings.selectList(null);
        List<Unit> allUnits = units.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer, Set<Integer>> links = linksByUnit();
        Map<Integer,List<Unit>> uByB = allUnits.stream().collect(Collectors.groupingBy(Unit::getBuildingId));
        Map<Integer,List<Contract>> cByB = allCt.stream().collect(Collectors.groupingBy(Contract::getBuildingId));
        return bs.stream().map(b -> toDTO(b,
            uByB.getOrDefault(b.getId(), List.of()), cByB.getOrDefault(b.getId(), List.of()), links)).toList();
    }

    public BuildingDetailDTO detail(Integer id) {
        Building b = buildings.selectById(id);
        if (b == null) throw new com.park.demo3.common.BizException(com.park.demo3.common.ResultCode.NOT_FOUND);
        List<Unit> us = units.selectByBuildingId(id);
        List<Contract> cs = contracts.selectByBuildingId(id);
        Map<Integer, Set<Integer>> links = linksByUnit();
        BuildingDTO dto = toDTO(b, us, cs, links);
        List<UnitDTO> unitDTOs = us.stream().map(u -> toUnitDTO(u, cs, links)).toList();
        return new BuildingDetailDTO(dto, unitDTOs);
    }

    /** detail 同款单元 DTO 组装(status/租户由该楼栋合同派生),单元 CRUD 回包复用 */
    UnitDTO toUnitDTO(Unit u, List<Contract> cs, Map<Integer, Set<Integer>> links) {
        String st = unitStatus(u.getId(), cs, links);
        Contract c = cs.stream()
            .filter(x -> occupies(x, u.getId(), links))
            .filter(x -> Set.of("active","expiring","draft")
                .contains(ContractService.effectiveStatus(x.getStatus(), x.getStartDate(), x.getEndDate())))
            .min(Comparator.comparing(x -> switch (ContractService.effectiveStatus(x.getStatus(), x.getStartDate(), x.getEndDate())) {
                case "active" -> 0; case "expiring" -> 1; default -> 2;
            })).orElse(null);
        Tenant t = c != null ? tenantMapper.selectById(c.getTenantId()) : null;
        return new UnitDTO(
            u.getId(), u.getFloor(), u.getUnitNo(), u.getArea(), st,
            t != null ? t.getId() : null,
            t != null ? t.getCompanyName() : null,
            t != null ? t.getCompanyName() : null,
            t != null ? t.getBusinessType() : null,
            c != null ? c.getContractNo() : null,
            c != null ? c.getMonthlyRent() : null
        );
    }

    @Transactional
    public BuildingDTO create(BuildingCreateReq req) {
        if (buildings.selectCount(new QueryWrapper<Building>().eq("name", req.name())) > 0)
            throw new BizException(ResultCode.CONFLICT, "楼栋名称已存在");
        int perFloor = req.perFloor() == null ? 0 : req.perFloor();
        Building b = new Building();
        b.setName(req.name()); b.setPhase(req.phase()); b.setFloorCount(req.floorCount());
        b.setTotalArea(req.totalArea()); b.setRentableArea(req.rentableArea());
        b.setStatus(1); b.setPerFloor(perFloor); b.setRemark(req.remark());
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
        return toDTO(buildings.selectById(b.getId()), units.selectByBuildingId(b.getId()), List.of(), Map.of());
    }

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
        b.setStatus(req.status()); b.setRemark(req.remark());
        buildings.updateById(b);
        return toDTO(buildings.selectById(id), units.selectByBuildingId(id), contracts.selectByBuildingId(id), linksByUnit());
    }

    public void delete(Integer id) {
        if (buildings.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "楼栋不存在");
        if (contracts.selectCount(new QueryWrapper<Contract>().eq("building_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "该楼栋下存在合同,请先处理合同");
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
        return toUnitDTO(units.selectById(u.getId()), List.of(), Map.of()); // 新单元无合同,必 vacant
    }

    public UnitDTO updateUnit(Integer id, UnitUpdateReq req) {
        Unit u = units.selectById(id);
        if (u == null) throw new BizException(ResultCode.NOT_FOUND, "单元不存在");
        requireFloorInRange(req.floor(), buildings.selectById(u.getBuildingId()));
        requireUniqueUnitNo(u.getBuildingId(), req.unitNo(), id);
        u.setFloor(req.floor()); u.setUnitNo(req.unitNo()); u.setArea(req.area());
        units.updateById(u);
        return toUnitDTO(u, contracts.selectByBuildingId(u.getBuildingId()), linksByUnit());
    }

    public void deleteUnit(Integer id) {
        if (units.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "单元不存在");
        if (contracts.selectCount(new QueryWrapper<Contract>().eq("unit_id", id)) > 0
            || contractUnits.selectCount(new QueryWrapper<ContractUnit>().eq("unit_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "单元存在合同记录,请先处理相关合同");
        units.deleteById(id);
    }

    public BuildingSummaryDTO summary() {
        List<BuildingDTO> all = list();
        int stopped = (int) all.stream().filter(d -> d.status()==0).count();
        BigDecimal rentable = all.stream().map(BuildingDTO::rentableArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        // 占用率仅按启用楼栋(status!=0)计：与单楼栋 toDTO「停用即 occRate=0」口径一致，
        // 否则停用楼栋的已租面积会进入全局分子分母，造成全局与单楼栋口径不一致
        BigDecimal occRentable = all.stream().filter(d -> d.status()!=0).map(BuildingDTO::rentableArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal occLeased = all.stream().filter(d -> d.status()!=0).map(BuildingDTO::leasedArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        double occ = occRentable.signum()==0 ? 0.0
            : Math.min(100.0, occLeased.divide(occRentable,4,RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(1000))
                .setScale(0,RoundingMode.HALF_UP).doubleValue()/10.0);
        int vacant = all.stream().mapToInt(BuildingDTO::vacantCount).sum();
        int unitCount = all.stream().mapToInt(BuildingDTO::unitCount).sum();
        return new BuildingSummaryDTO(all.size(), stopped, rentable, occ, vacant, unitCount);
    }
}
