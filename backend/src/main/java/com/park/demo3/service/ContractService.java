package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
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
        validateReq(req, null);
        Contract c = new Contract();
        applyReq(c, req);
        contracts.insert(c);
        return dtoOf(contracts.selectById(c.getId()));
    }

    /** PUT 语义:全字段编辑,校验同创建(合同号查重排除自身)。 */
    public ContractDTO update(Integer id, ContractCreateReq req) {
        Contract c = contracts.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        validateReq(req, id);
        applyReq(c, req);
        contracts.updateById(c);
        return dtoOf(contracts.selectById(id));
    }

    /** 终止合同;单元状态读时派生,终止后自动回 vacant。 */
    public ContractDTO terminate(Integer id) {
        Contract c = contracts.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        if ("terminated".equals(c.getStatus()))
            throw new BizException(ResultCode.CONFLICT, "合同已终止");
        c.setStatus("terminated");
        contracts.updateById(c);
        return dtoOf(contracts.selectById(id));
    }

    /** 续签:旧合同终止,新合同继承租户/楼栋/单元,可覆盖字段空则继承旧值。 */
    @Transactional
    public ContractDTO renew(Integer id, ContractRenewReq req) {
        Contract old = contracts.selectById(id);
        if (old == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        requireUniqueNo(req.contractNo(), null);
        if (req.startDate() != null && req.endDate() != null && req.endDate().isBefore(req.startDate()))
            throw new BizException(ResultCode.CONFLICT, "结束日期不能早于开始日期");

        old.setStatus("terminated");
        contracts.updateById(old);

        Contract c = new Contract();
        c.setContractNo(req.contractNo());
        c.setTenantId(old.getTenantId());
        c.setBuildingId(old.getBuildingId());
        c.setUnitId(old.getUnitId());
        c.setRentArea(req.rentArea() != null ? req.rentArea() : old.getRentArea());
        c.setMonthlyRent(req.monthlyRent() != null ? req.monthlyRent() : old.getMonthlyRent());
        c.setDeposit(req.deposit() != null ? req.deposit() : old.getDeposit());
        // V33:面积/单价描述同一场地,续签继承;免租期属旧租期条款,不继承(留空)
        c.setBuildingArea(old.getBuildingArea());
        c.setUnitPrice(old.getUnitPrice());
        c.setStartDate(req.startDate());
        c.setEndDate(req.endDate());
        c.setSignDate(req.signDate());
        c.setStatus("active");
        contracts.insert(c);
        return dtoOf(contracts.selectById(c.getId()));
    }

    // ponytail: 无表引用合同,直接 deleteById
    public void delete(Integer id) {
        if (contracts.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        contracts.deleteById(id);
    }

    // ─── 私有校验/组装(create/update 共用) ───────────────────

    private void requireUniqueNo(String contractNo, Integer excludeId) {
        QueryWrapper<Contract> q = new QueryWrapper<Contract>().eq("contract_no", contractNo);
        if (excludeId != null) q.ne("id", excludeId);
        if (contracts.selectCount(q) > 0) throw new BizException(ResultCode.CONFLICT, "合同号已存在");
    }

    private void validateReq(ContractCreateReq req, Integer excludeId) {
        requireUniqueNo(req.contractNo(), excludeId);
        if (tenants.selectById(req.tenantId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        if (buildings.selectById(req.buildingId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "楼栋不存在");
        if (req.unitId() != null) {
            Unit u = units.selectById(req.unitId());
            if (u == null || !Objects.equals(u.getBuildingId(), req.buildingId()))
                throw new BizException(ResultCode.CONFLICT, "单元不存在或不属于所选楼栋");
        }
        if (req.startDate() != null && req.endDate() != null && req.endDate().isBefore(req.startDate()))
            throw new BizException(ResultCode.CONFLICT, "结束日期不能早于开始日期");
        validateRentFree(req.rentFree());
    }

    // 免租期校验(V33/F2):合法 JSON 数组、每项 {start,end,note?}、ISO 日期且 start≤end、≤24 段。
    // 仅此,不校验是否在合同期内(前端提示不阻断)。违规 → body.code=400 中文错误。
    private static final ObjectMapper JSON = new ObjectMapper();

    private void validateRentFree(String rentFree) {
        if (rentFree == null || rentFree.isBlank()) return;
        JsonNode arr;
        try { arr = JSON.readTree(rentFree); }
        catch (JsonProcessingException e) { throw new BizException(ResultCode.BAD_REQUEST, "免租期必须是合法 JSON 数组"); }
        if (!arr.isArray()) throw new BizException(ResultCode.BAD_REQUEST, "免租期必须是合法 JSON 数组");
        if (arr.size() > 24) throw new BizException(ResultCode.BAD_REQUEST, "免租期最多 24 段");
        for (int i = 0; i < arr.size(); i++) {
            JsonNode seg = arr.get(i);
            String label = "免租期第 " + (i + 1) + " 段";
            if (!seg.isObject()) throw new BizException(ResultCode.BAD_REQUEST, label + "必须是 {start,end,note?} 对象");
            LocalDate start = parseIsoDate(seg.get("start"), label + "的开始日期");
            LocalDate end   = parseIsoDate(seg.get("end"),   label + "的结束日期");
            if (start.isAfter(end)) throw new BizException(ResultCode.BAD_REQUEST, label + "的开始日期不能晚于结束日期");
        }
    }

    private static LocalDate parseIsoDate(JsonNode node, String label) {
        if (node == null || !node.isTextual())
            throw new BizException(ResultCode.BAD_REQUEST, label + "缺失或不是字符串");
        try { return LocalDate.parse(node.asText()); }   // 严格 ISO:yyyy-MM-dd
        catch (DateTimeParseException e) {
            throw new BizException(ResultCode.BAD_REQUEST, label + "格式须为 yyyy-MM-dd");
        }
    }

    private void applyReq(Contract c, ContractCreateReq req) {
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
        // V33:建筑面积/单价可空即留空(存量不推测);免租期空白串归一为 NULL
        c.setBuildingArea(req.buildingArea());
        c.setUnitPrice(req.unitPrice());
        c.setRentFree(req.rentFree() == null || req.rentFree().isBlank() ? null : req.rentFree());
    }

    /** 单条回显:按 id 点查租户/楼栋/单元拼 DTO(写路径共用)。 */
    private ContractDTO dtoOf(Contract c) {
        Tenant t = tenants.selectById(c.getTenantId());
        Building b = buildings.selectById(c.getBuildingId());
        Unit u = c.getUnitId() != null ? units.selectById(c.getUnitId()) : null;
        Map<Integer,String> uFloor = (u != null && u.getFloor() != null && u.getUnitNo() != null)
            ? Map.of(u.getId(), u.getFloor() + "F-" + u.getUnitNo()) : Map.of();
        return toDTO(c,
            t != null ? Map.of(t.getId(), t.getCompanyName()) : Map.of(),
            b != null ? Map.of(b.getId(), b.getName()) : Map.of(),
            uFloor);
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
            c.getUnitId(), floorInfo,
            c.getBuildingArea(), c.getRentArea(), c.getUnitPrice(),
            c.getMonthlyRent(), c.getDeposit(),
            c.getStartDate() != null ? c.getStartDate().toString() : null,
            c.getEndDate()   != null ? c.getEndDate().toString()   : null,
            c.getSignDate()  != null ? c.getSignDate().toString()  : null,
            c.getStatus(), termMonths, daysToEnd, c.getRemark(), c.getRentFree()
        );
    }
}
