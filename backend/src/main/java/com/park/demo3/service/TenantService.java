package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import java.math.BigDecimal; import java.math.RoundingMode;
import java.util.*; import java.util.stream.Collectors;

@Service
public class TenantService {
    private final TenantMapper tenants; private final ContractMapper contracts;
    private final BuildingMapper buildings; private final TenantCategoryMapper categories;
    private final BuildingService buildingService;
    public TenantService(TenantMapper t, ContractMapper c, BuildingMapper b,
                         TenantCategoryMapper cat, BuildingService bs) {
        tenants=t; contracts=c; buildings=b; categories=cat; buildingService=bs;
    }
    static final Set<String> RENT = Set.of("active","expiring");

    public List<TenantDTO> list() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        Map<Integer,List<Contract>> cByT = allCt.stream().collect(Collectors.groupingBy(Contract::getTenantId));
        return ts.stream().map(t -> {
            List<Contract> cs = cByT.getOrDefault(t.getId(), List.of());
            List<Contract> current = cs.stream().filter(c -> RENT.contains(c.getStatus())).toList();
            BigDecimal monthly = current.stream().map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal area = current.stream().map(Contract::getRentArea).reduce(BigDecimal.ZERO, BigDecimal::add);
            String primary = current.isEmpty() ? "—" : bName.getOrDefault(current.get(0).getBuildingId(), "—");
            return new TenantDTO(t.getId(), t.getCompanyName(), t.getContactName(), t.getContactPhone(),
                t.getBusinessType(), t.getStatus(), t.getCategoryId(), t.getPhase(), t.getSince(),
                monthly, area, primary, cs.size());
        }).toList();
    }

    public TenantSummaryDTO summary() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        int active = (int) ts.stream().filter(t -> t.getStatus()==1).count();
        BigDecimal monthly = allCt.stream().filter(c -> RENT.contains(c.getStatus()))
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        int expiringTenants = (int) allCt.stream().filter(c -> "expiring".equals(c.getStatus()))
            .map(Contract::getTenantId).distinct().count();
        double occRate = buildingService.summary().occRate();
        return new TenantSummaryDTO(active, occRate, monthly, expiringTenants);
    }

    public List<TenantCategoryDTO> categoriesList() {
        return categories.selectList(null).stream().map(c -> new TenantCategoryDTO(c.getId(), c.getName())).toList();
    }
}
