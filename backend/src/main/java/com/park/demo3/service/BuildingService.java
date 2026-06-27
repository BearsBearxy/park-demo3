package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import java.math.BigDecimal; import java.math.RoundingMode;
import java.util.*; import java.util.stream.Collectors;

@Service
public class BuildingService {
    private final BuildingMapper buildings; private final UnitMapper units; private final ContractMapper contracts;
    public BuildingService(BuildingMapper b, UnitMapper u, ContractMapper c) { buildings=b; units=u; contracts=c; }

    static final Map<Integer,String> PHASE = Map.of(1,"一期",2,"二期",3,"三期",4,"宿舍");
    static String kind(int phase) { return phase == 4 ? "宿舍" : "厂房"; }
    static final Set<String> CURRENT = Set.of("active","expiring","draft"); // 占用相关
    static final Set<String> RENT = Set.of("active","expiring");            // 计租相关

    /** 单元派生状态: 取该单元 status∈current 的合同,active→occupied/expiring→expiring/draft→reserved,无→vacant */
    static String unitStatus(Integer unitId, List<Contract> cs) {
        String best = "vacant";
        for (Contract c : cs) {
            if (!Objects.equals(c.getUnitId(), unitId)) continue;
            switch (c.getStatus()) {
                case "active": return "occupied";
                case "expiring": best = "expiring"; break;
                case "draft": if (best.equals("vacant")) best = "reserved"; break;
                default: break;
            }
        }
        return best;
    }

    BuildingDTO toDTO(Building b, List<Unit> us, List<Contract> cs) {
        boolean stopped = b.getStatus() == 0;
        int occ=0, vac=0, exp=0, rsv=0; BigDecimal leased = BigDecimal.ZERO;
        for (Unit u : us) {
            String st = unitStatus(u.getId(), cs);
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
        BigDecimal monthly = cs.stream().filter(c -> RENT.contains(c.getStatus()))
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        List<Integer> tenantIds = cs.stream().filter(c -> RENT.contains(c.getStatus()))
            .map(Contract::getTenantId).distinct().collect(Collectors.toList());
        return new BuildingDTO(b.getId(), b.getName(), b.getPhase(), PHASE.get(b.getPhase()), kind(b.getPhase()),
            b.getFloorCount(), b.getTotalArea(), b.getRentableArea(), b.getStatus(),
            us.size(), occ, vac, exp, rsv, leased, occRate, monthly, tenantIds);
    }

    public List<BuildingDTO> list() {
        List<Building> bs = buildings.selectList(null);
        List<Unit> allUnits = units.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer,List<Unit>> uByB = allUnits.stream().collect(Collectors.groupingBy(Unit::getBuildingId));
        Map<Integer,List<Contract>> cByB = allCt.stream().collect(Collectors.groupingBy(Contract::getBuildingId));
        return bs.stream().map(b -> toDTO(b,
            uByB.getOrDefault(b.getId(), List.of()), cByB.getOrDefault(b.getId(), List.of()))).toList();
    }

    public BuildingSummaryDTO summary() {
        List<BuildingDTO> all = list();
        int stopped = (int) all.stream().filter(d -> d.status()==0).count();
        BigDecimal rentable = all.stream().map(BuildingDTO::rentableArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal leased = all.stream().map(BuildingDTO::leasedArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        double occ = rentable.signum()==0 ? 0.0
            : leased.divide(rentable,4,RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(1000))
                .setScale(0,RoundingMode.HALF_UP).doubleValue()/10.0;
        int vacant = all.stream().mapToInt(BuildingDTO::vacantCount).sum();
        return new BuildingSummaryDTO(all.size(), stopped, rentable, occ, vacant);
    }
}
