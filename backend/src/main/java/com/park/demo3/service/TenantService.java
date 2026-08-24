package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.park.demo3.common.BizException; import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.*; import java.util.stream.Collectors;

@Service
public class TenantService {
    private final TenantMapper tenants; private final ContractMapper contracts;
    private final BuildingMapper buildings; private final TenantCategoryMapper categories;
    private final BuildingService buildingService; private final UnitMapper units;
    private final MonthlyLedgerMapper ledger; private final S10RecordMapper s10Records;
    private final ReconMarkMapper reconMarks;
    public TenantService(TenantMapper t, ContractMapper c, BuildingMapper b,
                         TenantCategoryMapper cat, BuildingService bs, UnitMapper u,
                         MonthlyLedgerMapper ml, S10RecordMapper s10, ReconMarkMapper rm) {
        tenants=t; contracts=c; buildings=b; categories=cat; buildingService=bs; units=u;
        ledger=ml; s10Records=s10; reconMarks=rm;
    }

    public List<TenantDTO> list() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        Map<Integer,List<Contract>> cByT = allCt.stream().collect(Collectors.groupingBy(Contract::getTenantId));
        // 全表已在手:内存 map 补主租户名,避免逐行 selectById 的 N+1
        Map<Integer,String> tName = ts.stream()
            .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));
        return ts.stream().map(t -> buildTenantDto(t, cByT.getOrDefault(t.getId(), List.of()), bName,
            t.getParentId() == null ? null : tName.get(t.getParentId()))).toList();
    }

    public TenantSummaryDTO summary() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        int active = (int) ts.stream().filter(t -> t.getStatus()==1).count();
        // 月租金/将到期与合同屏同源(METRIC-SOURCE-SPEC §2):一律走 rentRollMetrics,不得自己按 status 列过滤
        ContractService.RentRoll rr = ContractService.rentRollMetrics(allCt);
        Double occRate = buildingService.summary().occRate();   // 算不出来透传 null(§3),不在此兜 0
        return new TenantSummaryDTO(active, occRate, rr.monthlyRent(), rr.expiringTenantIds().size());
    }

    // tenant 表无 company_name 唯一键(仅普通索引 idx_tenant_name),应用层 selectCount 查重
    public TenantDTO create(TenantCreateReq req) {
        if (tenants.selectCount(new QueryWrapper<Tenant>().eq("company_name", req.companyName())) > 0)
            throw new BizException(ResultCode.CONFLICT, "租户名称已存在");
        if (req.categoryId() != null && categories.selectById(req.categoryId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户分类不存在");
        validateParent(req.parentId(), null);
        Tenant t = new Tenant();
        t.setCompanyName(req.companyName()); t.setBusinessType(req.businessType());
        t.setContactName(req.contactName()); t.setContactPhone(req.contactPhone());
        t.setCategoryId(req.categoryId()); t.setPhase(req.phase()); t.setSince(req.since());
        t.setRemark(req.remark()); t.setStatus(1); t.setParentId(req.parentId());
        t.setAliases(req.aliases());
        tenants.insert(t);
        Tenant saved = tenants.selectById(t.getId());
        // 新租户无合同:buildTenantDto 对空合同列表返回 月租/面积=0、楼栋"—"、合同数 0,不炸
        return buildTenantDto(saved, List.of(), Map.of(), parentName(saved));
    }

    public TenantDTO update(Integer id, TenantUpdateReq req) {
        if (tenants.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        if (tenants.selectCount(new QueryWrapper<Tenant>()
                .eq("company_name", req.companyName()).ne("id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "租户名称已存在");
        if (req.categoryId() != null && categories.selectById(req.categoryId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户分类不存在");
        validateParent(req.parentId(), id);
        // PUT 全量语义:可空字段允许清空,用 UpdateWrapper 显式 set(updateById 会跳过 null 字段)
        tenants.update(null, new UpdateWrapper<Tenant>().eq("id", id)
            .set("company_name", req.companyName()).set("business_type", req.businessType())
            .set("contact_name", req.contactName()).set("contact_phone", req.contactPhone())
            .set("category_id", req.categoryId()).set("phase", req.phase())
            .set("since", req.since()).set("remark", req.remark()).set("status", req.status())
            .set("parent_id", req.parentId()).set("aliases", req.aliases()));
        List<Contract> cs = contracts.selectList(new QueryWrapper<Contract>().eq("tenant_id", id));
        Tenant saved = tenants.selectById(id);
        return buildTenantDto(saved, cs, bNameOf(cs), parentName(saved));
    }

    // 一级关联三重校验:查无→404;关联自己→409;所选主租户已是子租户→409(禁止二级链)
    private void validateParent(Integer parentId, Integer selfId) {
        if (parentId == null) return;
        if (parentId.equals(selfId)) throw new BizException(ResultCode.CONFLICT, "不能关联自己");
        Tenant p = tenants.selectById(parentId);
        if (p == null) throw new BizException(ResultCode.NOT_FOUND, "主租户不存在");
        if (p.getParentId() != null)
            throw new BizException(ResultCode.CONFLICT, "仅支持一级关联,所选租户已是子租户");
    }

    private String parentName(Tenant t) {
        // FK 保证 parent_id 非空即存在(ON DELETE SET NULL),selectById 不会落空
        return t.getParentId() == null ? null : tenants.selectById(t.getParentId()).getCompanyName();
    }

    @Transactional
    public void delete(Integer id) {
        if (tenants.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        // contract / monthly_ledger 的 tenant_id 为硬 FK:先守卫,给出可操作的中文提示
        if (contracts.selectCount(new QueryWrapper<Contract>().eq("tenant_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "该租户存在合同,请先处理合同");
        if (ledger.selectCount(new QueryWrapper<MonthlyLedger>().eq("tenant_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "该租户存在台账记录,不可删除");
        if (tenants.selectCount(new QueryWrapper<Tenant>().eq("parent_id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "该租户存在关联子租户,请先解除关联");
        // s10_record / recon_mark 的 tenant_id 为软引用(无 FK,tenant_name 兜底显示):置 NULL 再删
        s10Records.update(null, new UpdateWrapper<S10Record>()
            .eq("tenant_id", id).set("tenant_id", null));
        reconMarks.update(null, new UpdateWrapper<ReconMark>()
            .eq("tenant_id", id).set("tenant_id", null));
        tenants.deleteById(id);
    }

    public List<TenantCategoryDTO> categoriesList() {
        return categories.selectList(null).stream().map(c -> new TenantCategoryDTO(c.getId(), c.getName())).toList();
    }

    public TenantDetailDTO detail(Integer id) {
        Tenant t = tenants.selectById(id);
        if (t == null) throw new NoSuchElementException("tenant " + id);
        List<Contract> cs = contracts.selectList(new QueryWrapper<Contract>().eq("tenant_id", id));
        Map<Integer,String> bName = bNameOf(cs);
        // unitId → "{floor}F-{unitNo}";只有 cs 里的 unitId 会被 getOrDefault 读到,故按这批 id 收敛
        // ⚠ 空集守卫:无合同/合同全无单元时 ids 为空,MP 的 in(空集) 生成 `IN ()` 是 SQL 语法错(500)
        Set<Integer> uIds = cs.stream().map(Contract::getUnitId).filter(Objects::nonNull)
            .collect(Collectors.toSet());
        Map<Integer,String> uFloor = uIds.isEmpty() ? Map.of()
            : units.selectList(new QueryWrapper<Unit>().in("id", uIds)).stream()
                .filter(u -> u.getFloor() != null && u.getUnitNo() != null)
                .collect(Collectors.toMap(Unit::getId, u -> u.getFloor() + "F-" + u.getUnitNo()));

        TenantDTO tenantDto = buildTenantDto(t, cs, bName, parentName(t));
        List<ContractHistoryDTO> history = cs.stream().map(c -> new ContractHistoryDTO(
            c.getContractNo(),
            bName.getOrDefault(c.getBuildingId(), ""),
            c.getUnitId() != null ? uFloor.getOrDefault(c.getUnitId(), "") : "",
            c.getStartDate(), c.getEndDate(), c.getSignDate(),
            c.getMonthlyRent(), c.getRentArea(), c.getStatus()
        )).toList();
        return new TenantDetailDTO(tenantDto, history);
    }

    /** 单租户路径(update/detail)的楼栋名字典:bName 的读法全是 getOrDefault(该租户合同上的 buildingId),
     *  故只查这批 id 即可,DTO 逐字段不变。⚠ 空集守卫:新建/无合同租户 ids 为空,MP 的 in(空集)
     *  生成 `IN ()` 是 SQL 语法错(500),必须提前返空表 —— 空表配 getOrDefault("—"/"") 与全表 miss 同行为。
     *  list() 那条路径是全量合同,仍需全表字典,不走这里。 */
    private Map<Integer,String> bNameOf(List<Contract> cs) {
        Set<Integer> ids = cs.stream().map(Contract::getBuildingId).filter(Objects::nonNull)
            .collect(Collectors.toSet());
        return ids.isEmpty() ? Map.of()
            : buildings.selectList(new QueryWrapper<Building>().in("id", ids)).stream()
                .collect(Collectors.toMap(Building::getId, Building::getName));
    }

    // ponytail: extracted so list() and detail() share derivation without re-querying all tenants
    private TenantDTO buildTenantDto(Tenant t, List<Contract> cs, Map<Integer,String> bName, String parentName) {
        // 在租判定取展示态(§5.1 日期派生),与楼栋屏 toDTO 同一把尺:直读 status 列会把已到期/未起租的算成在租
        List<Contract> current = cs.stream()
            .filter(c -> BuildingService.RENT.contains(
                ContractService.effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate())))
            .sorted(Comparator.comparing(Contract::getId,
                Comparator.nullsFirst(Comparator.naturalOrder()))).toList();
        BigDecimal monthly = current.stream().map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal area = current.stream().map(Contract::getRentArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        String primary = current.isEmpty() ? "—" : bName.getOrDefault(current.get(0).getBuildingId(), "—");
        return new TenantDTO(t.getId(), t.getCompanyName(), t.getContactName(), t.getContactPhone(),
            t.getBusinessType(), t.getStatus(), t.getCategoryId(), t.getPhase(), t.getSince(),
            monthly, area, primary, cs.size(), t.getRemark(), t.getParentId(), parentName, t.getAliases());
    }

    /** 匹配名集合=正名+别名(逗号/中文逗号分隔,V86):导入与挂号按名匹配时与正名同权。
     *  去重去空白;多租户共用同一别名时各匹配点的「唯一命中才挂」护栏自动落待核。 */
    public static List<String> matchNames(Tenant t) {
        LinkedHashSet<String> names = new LinkedHashSet<>();
        names.add(t.getCompanyName());
        if (t.getAliases() != null)
            for (String a : t.getAliases().split("[,，]"))
                if (!a.isBlank()) names.add(a.trim());
        return new ArrayList<>(names);
    }

    /** 软引用解析索引:账面名 → 唯一可判定的租户 id(台账/附表10 导入与改名自动配档共用)。
     *  含全部状态(退租户也算——导入月当时可能还在租,这正是"只配在租"老规则的病根);
     *  同名冲突:在租唯一者胜;仍不唯一则不入表 → 该名留未绑定,由问题面板人工选(绝不瞎猜)。 */
    public static Map<String, Integer> softIndex(List<Tenant> all) {
        Map<String, List<Tenant>> byName = new HashMap<>();
        for (Tenant t : all)
            for (String n : matchNames(t)) {
                String key = n == null ? "" : n.trim();   // 评审A6:档案名可能带首尾空白,查询侧全是 trim 过的
                if (!key.isEmpty()) byName.computeIfAbsent(key, k -> new ArrayList<>()).add(t);
            }
        Map<String, Integer> idx = new HashMap<>();
        for (var e : byName.entrySet()) {
            List<Tenant> cands = e.getValue();
            List<Tenant> active = cands.stream()
                .filter(t -> t.getStatus() != null && t.getStatus() == 1).toList();
            Tenant pick = active.size() == 1 ? active.get(0)
                        : (active.isEmpty() && cands.size() == 1 ? cands.get(0) : null);
            if (pick != null) idx.put(e.getKey(), pick.getId());
        }
        return idx;
    }
}
