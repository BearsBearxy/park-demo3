package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ContractService {
    private final ContractMapper contracts;
    private final TenantMapper   tenants;
    private final BuildingMapper buildings;
    private final UnitMapper     units;

    public ContractService(ContractMapper contracts, TenantMapper tenants,
                           BuildingMapper buildings, UnitMapper units) {
        this.contracts = contracts; this.tenants = tenants;
        this.buildings = buildings; this.units   = units;
    }

    public List<ContractDTO> list() {
        List<Contract> all = contracts.selectList(null);

        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));

        // unitId → "{floor}F-{unitNo}" (same derivation as TenantService.detail)
        Map<Integer,String> uFloor = units.selectList(null).stream()
            .filter(u -> u.getFloor() != null && u.getUnitNo() != null)
            .collect(Collectors.toMap(Unit::getId, u -> u.getFloor() + "F-" + u.getUnitNo()));

        Map<Integer,String> tName = tenants.selectList(null).stream()
            .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));

        return all.stream().map(c -> toDTO(c, tName, bName, uFloor)).toList();
    }

    public ContractSummaryDTO summary() {
        List<Contract> all = contracts.selectList(null);
        int total = all.size();
        int active = 0, expiring = 0, draft = 0;
        BigDecimal monthly = BigDecimal.ZERO;
        for (Contract c : all) {
            switch (c.getStatus()) {
                case "active":    active++;   monthly = monthly.add(c.getMonthlyRent()); break;
                case "expiring":  expiring++; monthly = monthly.add(c.getMonthlyRent()); break;
                case "draft":     draft++;    break;
                default: break;
            }
        }
        return new ContractSummaryDTO(total, active, expiring, draft, monthly);
    }

    public ContractDetailDTO detail(Integer id) {
        Contract c = contracts.selectById(id);
        if (c == null) throw new NoSuchElementException("contract " + id);
        Tenant t = tenants.selectById(c.getTenantId());
        if (t == null) throw new NoSuchElementException("tenant " + c.getTenantId());

        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        Map<Integer,String> uFloor = units.selectList(null).stream()
            .filter(u -> u.getFloor() != null && u.getUnitNo() != null)
            .collect(Collectors.toMap(Unit::getId, u -> u.getFloor() + "F-" + u.getUnitNo()));
        Map<Integer,String> tName = Map.of(t.getId(), t.getCompanyName());

        ContractDTO dto = toDTO(c, tName, bName, uFloor);
        ContractDetailDTO.TenantSnap snap = new ContractDetailDTO.TenantSnap(
            t.getCompanyName(), t.getContactName(), t.getContactPhone(),
            t.getBusinessType(), t.getStatus()
        );
        return new ContractDetailDTO(dto, snap);
    }

    // ponytail: shared derivation — list() and detail() both call this
    private ContractDTO toDTO(Contract c, Map<Integer,String> tName,
                              Map<Integer,String> bName, Map<Integer,String> uFloor) {
        int termMonths = (c.getStartDate() != null && c.getEndDate() != null)
            ? (int) ChronoUnit.MONTHS.between(c.getStartDate(), c.getEndDate()) : 0;
        Integer daysToEnd = c.getEndDate() != null
            ? (int) ChronoUnit.DAYS.between(LocalDate.now(ZoneId.of("Asia/Shanghai")), c.getEndDate()) : null;
        String floorInfo = c.getUnitId() != null ? uFloor.getOrDefault(c.getUnitId(), "") : "";
        return new ContractDTO(
            c.getId(), c.getContractNo(),
            c.getTenantId(), tName.getOrDefault(c.getTenantId(), ""),
            c.getBuildingId(), bName.getOrDefault(c.getBuildingId(), ""),
            floorInfo,
            c.getRentArea(), c.getMonthlyRent(), c.getDeposit(),
            c.getStartDate() != null ? c.getStartDate().toString() : null,
            c.getEndDate()   != null ? c.getEndDate().toString()   : null,
            c.getSignDate()  != null ? c.getSignDate().toString()  : null,
            c.getStatus(), termMonths, daysToEnd, c.getRemark()
        );
    }
}
