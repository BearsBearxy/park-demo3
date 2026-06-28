package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.util.*; import java.util.stream.Collectors;

@Service
public class TenantService {
    private final TenantMapper tenants; private final ContractMapper contracts;
    private final BuildingMapper buildings; private final TenantCategoryMapper categories;
    private final BuildingService buildingService; private final UnitMapper units;
    public TenantService(TenantMapper t, ContractMapper c, BuildingMapper b,
                         TenantCategoryMapper cat, BuildingService bs, UnitMapper u) {
        tenants=t; contracts=c; buildings=b; categories=cat; buildingService=bs; units=u;
    }

    public List<TenantDTO> list() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        Map<Integer,List<Contract>> cByT = allCt.stream().collect(Collectors.groupingBy(Contract::getTenantId));
        return ts.stream().map(t -> buildTenantDto(t, cByT.getOrDefault(t.getId(), List.of()), bName)).toList();
    }

    public TenantSummaryDTO summary() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        int active = (int) ts.stream().filter(t -> t.getStatus()==1).count();
        BigDecimal monthly = allCt.stream().filter(c -> BuildingService.RENT.contains(c.getStatus()))
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        int expiringTenants = (int) allCt.stream().filter(c -> "expiring".equals(c.getStatus()))
            .map(Contract::getTenantId).distinct().count();
        double occRate = buildingService.summary().occRate();
        return new TenantSummaryDTO(active, occRate, monthly, expiringTenants);
    }

    public List<TenantCategoryDTO> categoriesList() {
        return categories.selectList(null).stream().map(c -> new TenantCategoryDTO(c.getId(), c.getName())).toList();
    }

    public TenantDetailDTO detail(Integer id) {
        Tenant t = tenants.selectById(id);
        if (t == null) throw new NoSuchElementException("tenant " + id);
        List<Contract> cs = contracts.selectList(new QueryWrapper<Contract>().eq("tenant_id", id));
        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        // unitId → "{floor}F-{unitNo}"
        Map<Integer,String> uFloor = units.selectList(null).stream()
            .filter(u -> u.getFloor() != null && u.getUnitNo() != null)
            .collect(Collectors.toMap(Unit::getId, u -> u.getFloor() + "F-" + u.getUnitNo()));

        TenantDTO tenantDto = buildTenantDto(t, cs, bName);
        List<ContractHistoryDTO> history = cs.stream().map(c -> new ContractHistoryDTO(
            c.getContractNo(),
            bName.getOrDefault(c.getBuildingId(), ""),
            c.getUnitId() != null ? uFloor.getOrDefault(c.getUnitId(), "") : "",
            c.getStartDate(), c.getEndDate(), c.getSignDate(),
            c.getMonthlyRent(), c.getRentArea(), c.getStatus()
        )).toList();
        return new TenantDetailDTO(tenantDto, history);
    }

    // ponytail: extracted so list() and detail() share derivation without re-querying all tenants
    private TenantDTO buildTenantDto(Tenant t, List<Contract> cs, Map<Integer,String> bName) {
        List<Contract> current = cs.stream().filter(c -> BuildingService.RENT.contains(c.getStatus()))
            .sorted(Comparator.comparing(Contract::getId,
                Comparator.nullsFirst(Comparator.naturalOrder()))).toList();
        BigDecimal monthly = current.stream().map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal area = current.stream().map(Contract::getRentArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        String primary = current.isEmpty() ? "—" : bName.getOrDefault(current.get(0).getBuildingId(), "—");
        return new TenantDTO(t.getId(), t.getCompanyName(), t.getContactName(), t.getContactPhone(),
            t.getBusinessType(), t.getStatus(), t.getCategoryId(), t.getPhase(), t.getSince(),
            monthly, area, primary, cs.size(), t.getRemark());
    }
}
