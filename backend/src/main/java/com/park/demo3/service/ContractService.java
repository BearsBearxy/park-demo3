package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
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

    public ContractDTO create(ContractCreateReq req) {
        if (contracts.selectCount(new QueryWrapper<Contract>().eq("contract_no", req.contractNo())) > 0)
            throw new BizException(ResultCode.CONFLICT, "合同号已存在");
        Tenant t = tenants.selectById(req.tenantId());
        if (t == null) throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        Building b = buildings.selectById(req.buildingId());
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "楼栋不存在");
        Unit u = null;
        if (req.unitId() != null) {
            u = units.selectById(req.unitId());
            if (u == null || !Objects.equals(u.getBuildingId(), req.buildingId()))
                throw new BizException(ResultCode.CONFLICT, "单元不存在或不属于所选楼栋");
        }
        if (req.startDate() != null && req.endDate() != null && req.endDate().isBefore(req.startDate()))
            throw new BizException(ResultCode.CONFLICT, "结束日期不能早于开始日期");

        Contract c = new Contract();
        c.setContractNo(req.contractNo());
        c.setTenantId(req.tenantId());
        c.setBuildingId(req.buildingId());
        c.setUnitId(req.unitId());
        c.setRentArea(req.rentArea() != null ? req.rentArea() : BigDecimal.ZERO);
        c.setMonthlyRent(req.monthlyRent() != null ? req.monthlyRent() : BigDecimal.ZERO);
        c.setDeposit(req.deposit() != null ? req.deposit() : BigDecimal.ZERO);
        c.setStartDate(req.startDate());
        c.setEndDate(req.endDate());
        c.setSignDate(req.signDate());
        c.setStatus(req.status());
        c.setRemark(req.remark());
        contracts.insert(c);

        Contract saved = contracts.selectById(c.getId());
        Map<Integer,String> uFloor = (u != null && u.getFloor() != null && u.getUnitNo() != null)
            ? Map.of(u.getId(), u.getFloor() + "F-" + u.getUnitNo()) : Map.of();
        return toDTO(saved, Map.of(t.getId(), t.getCompanyName()), Map.of(b.getId(), b.getName()), uFloor);
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
