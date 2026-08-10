package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
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
import java.math.RoundingMode;
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
    private final ContractBillingTermMapper terms;   // V51 起仅作「其他费项」留档表(§1.1 零静默丢弃)
    private final ContractUnitMapper contractUnits;  // V58 附加单元(主单元在 unit_id),floorInfo 显「等N单元」
    private final BillingTermUnitMapper termUnits;   // S15:计费行↔单元绑定(V91),整组替换时快照回挂防孤儿

    public ContractService(ContractMapper contracts, TenantMapper tenants,
                           BuildingMapper buildings, UnitMapper units,
                           ContractBillingTermMapper terms, ContractUnitMapper contractUnits,
                           BillingTermUnitMapper termUnits) {
        this.contracts = contracts; this.tenants = tenants;
        this.buildings = buildings; this.units   = units;
        this.terms = terms; this.contractUnits = contractUnits;
        this.termUnits = termUnits;
    }

    /** 全量列表;asOfDate 非空 → 某日在租过滤(§5.2/§8⑦):非草稿且 startDate≤asOf≤endDate。 */
    public List<ContractDTO> list(String asOfDate) {
        List<Contract> all = contracts.selectList(null);

        LocalDate asOf = blankToNull(asOfDate) == null ? null : parseAsOf(asOfDate);
        if (asOf != null) {
            all = all.stream().filter(c -> inForceOn(c, asOf)).toList();
        }

        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));

        // unitId → "{floor}F-{unitNo}" (same derivation as TenantService.detail)
        Map<Integer,String> uFloor = units.selectList(null).stream()
            .filter(u -> u.getFloor() != null && u.getUnitNo() != null)
            .collect(Collectors.toMap(Unit::getId, u -> u.getFloor() + "F-" + u.getUnitNo()));

        Map<Integer,String> tName = tenants.selectList(null).stream()
            .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));

        Map<Integer,Long> extraUnits = extraUnitCounts();
        return all.stream().map(c -> toDTO(c, tName, bName, uFloor, extraUnits)).toList();
    }

    /** 某日在租:非草稿且当日落在 [startDate, endDate] 闭区间(缺任一端日期视为无法确认在租,排除)。 */
    public static boolean inForceOn(Contract c, LocalDate asOf) {
        if ("draft".equals(c.getStatus())) return false;
        if (c.getStartDate() == null || c.getEndDate() == null) return false;
        return !asOf.isBefore(c.getStartDate()) && !asOf.isAfter(c.getEndDate());
    }

    private static LocalDate parseAsOf(String s) {
        try { return LocalDate.parse(s.trim()); }
        catch (DateTimeParseException e) { throw new BizException(ResultCode.BAD_REQUEST, "asOfDate 格式须为 yyyy-MM-dd"); }
    }

    public ContractSummaryDTO summary() {
        List<Contract> all = contracts.selectList(null);
        int total = all.size();
        int active = 0, expiring = 0, draft = 0;
        BigDecimal monthly = BigDecimal.ZERO;
        for (Contract c : all) {
            // V59:整体承租(master_lease)与散户空间重叠,月租金计入即双算 → KPI 金额排除,份数照计
            boolean master = "master_lease".equals(c.getKind());
            switch (effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate())) {   // 派生桶计数(§5.1)
                case "active":    active++;   if (!master) monthly = monthly.add(c.getMonthlyRent()); break;
                case "expiring":  expiring++; if (!master) monthly = monthly.add(c.getMonthlyRent()); break;
                case "draft":     draft++;    break;
                default: break;   // expired/terminated/renewed 不计
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

        ContractDTO dto = toDTO(c, tName, bName, uFloor, extraUnitCounts());
        ContractDetailDTO.TenantSnap snap = new ContractDetailDTO.TenantSnap(
            t.getCompanyName(), t.getContactName(), t.getContactPhone(),
            t.getBusinessType(), t.getStatus()
        );
        List<Integer> extraIds = contractUnits.selectList(
                new QueryWrapper<ContractUnit>().eq("contract_id", id).orderByAsc("id"))
            .stream().map(ContractUnit::getUnitId).toList();
        return new ContractDetailDTO(dto, snap, loadLines(id), extraIds);
    }

    @Transactional
    public ContractDTO create(ContractCreateReq req) {
        validateReq(req, null);
        validateLinesOrThrow(req.billingLines());
        Contract c = new Contract();
        applyReq(c, req);
        // 建档即人工录:非空计费字段标 manual,后续导入不覆盖(§1.2-5)
        Map<String,String> src = new LinkedHashMap<>();
        if (req.unitPrice() != null)      src.put("rent", "manual");
        if (req.mgmtFeePrice() != null)   src.put("mgmt", "manual");
        if (req.infraFeePrice() != null)  src.put("infra", "manual");
        if (req.elevatorFee() != null)    src.put("elevator", "manual");
        if (req.transformerFee() != null) src.put("transformer", "manual");
        c.setFeeSrc(writeFeeSrc(src));
        contracts.insert(c);
        if (req.billingLines() != null) {              // 计费行整组落库 + 反向同步五标量缓存
            replaceLinesFromReq(c.getId(), req.billingLines(), Map.of());
            syncScalarCache(c);
            contracts.updateById(c);
        }
        replaceExtraUnits(c.getId(), req.extraUnitIds());
        return dtoOf(contracts.selectById(c.getId()));
    }

    /** PUT 语义:全字段编辑,校验同创建(合同号查重排除自身)。人工改动的计费字段在 fee_src 标 manual(导入保留)。 */
    @Transactional
    public ContractDTO update(Integer id, ContractCreateReq req) {
        Contract c = contracts.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        validateReq(req, id);
        validateLinesOrThrow(req.billingLines());
        Map<String,String> src = readFeeSrc(c);
        markManualIfChanged(src, "rent",        c.getUnitPrice(),      req.unitPrice());
        markManualIfChanged(src, "mgmt",        c.getMgmtFeePrice(),   req.mgmtFeePrice());
        markManualIfChanged(src, "infra",       c.getInfraFeePrice(),  req.infraFeePrice());
        markManualIfChanged(src, "elevator",    c.getElevatorFee(),    req.elevatorFee());
        markManualIfChanged(src, "transformer", c.getTransformerFee(), req.transformerFee());
        markManualIfChanged(src, "area",        c.getRentArea(),
            req.rentArea() != null ? req.rentArea() : BigDecimal.ZERO);   // applyReq 同款缺省,避免 null 误判为改动
        applyReq(c, req);
        c.setFeeSrc(writeFeeSrc(src));
        // 计费行整组替换(单一编辑模式最终态):保留同 id 行原 source(手录不丢),新行标 manual;
        // 落库后从租金主行反向同步五标量缓存(§1.1)——覆盖 applyReq 写入的标量。
        List<String> warnings = List.of();
        if (req.billingLines() != null) {
            Map<Integer,String> oldSrc = terms.selectList(
                    new QueryWrapper<ContractBillingTerm>().eq("contract_id", id)).stream()
                .collect(Collectors.toMap(ContractBillingTerm::getId, ContractBillingTerm::getSource));
            warnings = replaceLinesFromReq(id, req.billingLines(), oldSrc);
            syncScalarCache(c);
        }
        contracts.updateById(c);
        replaceExtraUnits(id, req.extraUnitIds());
        return dtoOf(contracts.selectById(id), warnings.isEmpty() ? null : warnings);
    }

    /** 附加单元整组替换(语义同 billingLines:null=不动;空列表=清空)。占用/楼栋派生读时按 主单元∪附加 并集。 */
    private void replaceExtraUnits(Integer contractId, List<Integer> unitIds) {
        if (unitIds == null) return;
        contractUnits.delete(new QueryWrapper<ContractUnit>().eq("contract_id", contractId));
        for (Integer uid : unitIds) {
            ContractUnit cu = new ContractUnit();
            cu.setContractId(contractId);
            cu.setUnitId(uid);
            contractUnits.insert(cu);
        }
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

    /** 续签(§5.3):旧合同 status='renewed'(非 terminated),新合同 parentContractId=旧 id 并继承计费行;
     *  可覆盖字段空则继承旧值。 */
    @Transactional
    public ContractDTO renew(Integer id, ContractRenewReq req) {
        Contract old = contracts.selectById(id);
        if (old == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        requireUniqueNo(req.contractNo(), null);
        if (req.startDate() != null && req.endDate() != null && req.endDate().isBefore(req.startDate()))
            throw new BizException(ResultCode.CONFLICT, "结束日期不能早于开始日期");

        old.setStatus("renewed");   // V54:被续签取代,区别主动终止 terminated
        contracts.updateById(old);

        Contract c = new Contract();
        c.setContractNo(req.contractNo());
        c.setParentContractId(old.getId());   // V54 续签链
        c.setLinkType("renew");               // V57 链接类型(ESCALATION-SPLIT-SPEC §1)
        c.setTenantId(old.getTenantId());
        c.setBuildingId(old.getBuildingId());
        c.setUnitId(old.getUnitId());
        c.setRentArea(req.rentArea() != null ? req.rentArea() : old.getRentArea());
        c.setMonthlyRent(req.monthlyRent() != null ? req.monthlyRent() : old.getMonthlyRent());
        c.setDeposit(req.deposit() != null ? req.deposit() : old.getDeposit());
        // V33/V51:面积/单价/五费项/电费要素描述同一场地与签约条件,续签继承;免租期属旧租期条款,不继承(留空)
        c.setBuildingArea(old.getBuildingArea());
        c.setUnitPrice(old.getUnitPrice());
        c.setMgmtFeePrice(old.getMgmtFeePrice());
        c.setInfraFeePrice(old.getInfraFeePrice());
        c.setElevatorCount(old.getElevatorCount());
        c.setElevatorFloors(old.getElevatorFloors());
        c.setElevatorFee(old.getElevatorFee());
        c.setTransformerFee(old.getTransformerFee());
        c.setPowerType(old.getPowerType());
        c.setKva(old.getKva());
        c.setFeeSrc(old.getFeeSrc());
        c.setStartDate(req.startDate());
        c.setEndDate(req.endDate());
        c.setSignDate(req.signDate());
        c.setStatus("active");
        contracts.insert(c);
        // 续签继承计费行(§1.3):逐行复制到新合同,source 沿旧(手录/导入语义保留)
        List<ContractBillingTerm> oldLines = terms.selectList(
                new QueryWrapper<ContractBillingTerm>().eq("contract_id", old.getId()).orderByAsc("seq", "id"));
        for (ContractBillingTerm ol : oldLines) {
            ContractBillingTerm nl = new ContractBillingTerm();
            nl.setContractId(c.getId());
            nl.setPropertyType(ol.getPropertyType());
            nl.setLocation(ol.getLocation()); nl.setFeeKey(ol.getFeeKey()); nl.setFeeName(ol.getFeeName());
            nl.setBillMode(ol.getBillMode()); nl.setUnitPrice(ol.getUnitPrice()); nl.setArea(ol.getArea());
            nl.setAreaShared(ol.getAreaShared());
            nl.setCoeff(ol.getCoeff()); nl.setRoomCount(ol.getRoomCount()); nl.setAmountOverride(ol.getAmountOverride());
            nl.setSeq(ol.getSeq()); nl.setTaxRate(ol.getTaxRate()); nl.setParams(ol.getParams());
            nl.setNote(ol.getNote()); nl.setSource(ol.getSource());
            terms.insert(nl);
        }
        return dtoOf(contracts.selectById(c.getId()));
    }

    // ponytail: 留档费项行经 FK ON DELETE CASCADE 随删(V48),直接 deleteById
    public void delete(Integer id) {
        if (contracts.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "合同不存在");
        contracts.deleteById(id);
    }

    // ─── 计费行整组导入(BILL-FORWARD 刀1 三次返工 §1.2/§1.7,FeeRow 1:1) ────────
    // 覆盖律:按合同整组替换 source='import' 行,人工改过(manual)行保留;落库后反向同步五标量缓存;
    // 行级错误(合同不存在/费项枚举非法/负值)跳过不整批拦。

    @Transactional
    public ImportResultDTO importBillingLines(BillingLinesImportRequest req) {
        List<ImportError> errors = new ArrayList<>();
        int imported = 0, i = -1;
        for (BillingLinesImportRequest.Row r : req.rows()) {
            i++;
            Contract c = r.contractId() == null ? null : contracts.selectById(r.contractId());
            if (c == null) { errors.add(new ImportError(i, "合同" + r.contractId(), "合同不存在")); continue; }
            String err = validateLines(r.lines());
            if (err != null) { errors.add(new ImportError(i, "合同" + r.contractId(), err)); continue; }

            replaceImportLines(c, r.lines());
            contracts.updateById(c);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    /** 整组替换该合同的 source='import' 计费行(manual 保留),落库后反向同步五标量缓存;调用方负责 updateById。 */
    private void replaceImportLines(Contract c, List<BillingLinesImportRequest.Line> lines) {
        terms.delete(new QueryWrapper<ContractBillingTerm>()
            .eq("contract_id", c.getId()).eq("source", "import"));
        int seq = 0;
        if (lines != null) {
            for (BillingLinesImportRequest.Line l : lines) {
                ContractBillingTerm t = new ContractBillingTerm();
                t.setContractId(c.getId());
                t.setLocation(defaultLocation(l.location()));
                t.setPropertyType(blankToNull(l.propertyType()));
                t.setFeeKey(l.feeKey());
                t.setFeeName(feeLabel(l.propertyType(), l.feeKey()));
                t.setBillMode(blankToNull(l.billMode()) == null ? defaultBillMode(l.feeKey()) : l.billMode());
                t.setArea(l.area());
                t.setAreaShared(l.areaShared());
                t.setUnitPrice(l.unitPrice() == null ? BigDecimal.ZERO : l.unitPrice());
                t.setCoeff(l.coeff() == null ? BigDecimal.ONE : l.coeff());
                t.setRoomCount(l.roomCount());
                t.setAmountOverride(l.amountOverride());
                t.setSeq(seq++);
                t.setNote(blankToNull(l.note()));
                t.setSource("import");
                terms.insert(t);
            }
        }
        syncScalarCache(c);
    }

    // ─── 合同全量导入(POST /api/contracts/import-full) ──────────────────
    // 一行=一户:租户匹配(企业全称优先,简称+期兜底)→ 在册合同(单份直用/多份取最新期/无则自动新建 C2024M-序)
    // → 写期限原文三字段 + 整组替换 import 计费行(manual 保留)+ syncScalarCache;行级错误跳过不整批拦。

    private static final String IMPORT_NO_PREFIX = "C2024M-";
    private static final Set<String> TERM_TYPES = Set.of("explicit","multiple","relative","none");

    @Transactional
    public ContractFullImportRequest.Result importFull(ContractFullImportRequest req) {
        List<ImportError> errors = new ArrayList<>();
        List<ContractFullImportRequest.Item> report = new ArrayList<>();
        List<Tenant> allTenants = tenants.selectList(null);
        List<Building> allBuildings = buildings.selectList(null);
        int matched = 0, created = 0, nextNo = nextImportNoSeq();
        // 批内认领台账:同租户多行(如广联一期/二期同名落同一户)不得抢同一份合同互相覆盖起止
        Set<Integer> claimed = new HashSet<>();

        int i = -1;
        for (ContractFullImportRequest.Row r : req.rows()) {
            i++;
            String label = blankToNull(r.tenantFullName()) != null ? r.tenantFullName() : r.tenantName();

            String err = rowError(r);
            Tenant t = err != null ? null : matchTenant(allTenants, r);
            if (err == null && t == null) err = "未找到匹配租户(全称/简称/别名+期均未唯一命中)";
            if (err != null) {
                errors.add(new ImportError(i, label, err));
                report.add(new ContractFullImportRequest.Item(i, label, null, null, null, "skipped", err));
                continue;
            }

            // 已拆递增链防线(ESCALATION-SPLIT-SPEC §4):该户存在 escalation 段即整行跳过——
            // 拆链后原行价与起点已按末档改写且带 parent,重导会匹配失败另建重复合同并拍回旧值。
            if (contracts.exists(new QueryWrapper<Contract>()
                    .eq("tenant_id", t.getId()).eq("link_type", "escalation"))) {
                String reason = "该户已拆递增链,合同导入跳过(ESCALATION-SPLIT-SPEC §4)";
                errors.add(new ImportError(i, label, reason));
                report.add(new ContractFullImportRequest.Item(i, label, t.getId(), null, null, "skipped", reason));
                continue;
            }

            // 多租期 A 类:首期已被上次导入标成 renewed(不在 owned 里),故先按 tenantId+startDate 认领,保幂等
            List<ContractFullImportRequest.Term> chain =
                r.terms() == null ? List.of() : r.terms();
            Contract c = chain.size() > 1 ? findByStart(t.getId(), chain.get(0).startDate()) : null;
            String action = "matched";
            if (c != null) {
                matched++;
            } else {
                // 在册合同:排除已终止/已续签、排除续签链子期(parent 非空的不参与认领,否则会被无 terms 的行
                // 抢去覆写起止 → 下次 findByStart 失配再建一份,链分叉)、排除批内已认领
                List<Contract> owned = contracts.selectList(new QueryWrapper<Contract>()
                    .eq("tenant_id", t.getId()).notIn("status", "terminated", "renewed")
                    .isNull("parent_contract_id")
                    .orderByDesc("start_date").orderByDesc("id"))
                    .stream().filter(o -> !claimed.contains(o.getId())).toList();
                if (owned.isEmpty()) {
                    Integer bid = resolveBuilding(allBuildings, r.buildingHint(), r.phase());
                    if (bid == null) {
                        String reason = "无法确定楼栋(物业位置原文未匹配且无同期楼栋)";
                        errors.add(new ImportError(i, label, reason));
                        report.add(new ContractFullImportRequest.Item(i, label, t.getId(), null, null, "skipped", reason));
                        continue;
                    }
                    c = new Contract();
                    c.setContractNo(IMPORT_NO_PREFIX + String.format("%03d", nextNo++));
                    c.setTenantId(t.getId());
                    c.setBuildingId(bid);
                    c.setStatus("active");
                    c.setRentArea(BigDecimal.ZERO);
                    c.setMonthlyRent(BigDecimal.ZERO);
                    c.setDeposit(BigDecimal.ZERO);
                    contracts.insert(c);
                    created++; action = "created";
                } else {
                    c = owned.get(0);
                    matched++;
                }
            }

            claimed.add(c.getId());
            // 期限原文三字段 + 起止日期 + 备注:空值不覆盖既有(导入不擦人工录入)
            if (blankToNull(r.termText()) != null)      c.setTermText(r.termText().trim());
            if (blankToNull(r.termType()) != null)      c.setTermType(r.termType().trim());
            if (blankToNull(r.tierPriceNote()) != null) c.setTierPriceNote(r.tierPriceNote().trim());
            if (r.startDate() != null) c.setStartDate(r.startDate());
            if (r.endDate() != null)   c.setEndDate(r.endDate());
            if (blankToNull(r.remark()) != null) c.setRemark(r.remark().trim());

            replaceImportLines(c, r.lines());
            // A 类多租期:本期 = 表里明细期(计费行挂它),非末期 → renewed;后续期逐期建/更新并串 parentContractId
            if (chain.size() > 1) c.setStatus("renewed");
            contracts.updateById(c);
            report.add(new ContractFullImportRequest.Item(i, label, t.getId(), c.getId(), c.getContractNo(), action,
                chain.size() > 1 ? "续签链第1期(挂计费行)" : null));

            Contract prev = c;
            for (int k = 1; k < chain.size(); k++) {
                ContractFullImportRequest.Term tm = chain.get(k);
                Contract n = findByStart(t.getId(), tm.startDate());   // 幂等键:同租户同起租日 = 同一期,不重复建链
                boolean isNew = n == null;
                if (isNew) {
                    n = new Contract();
                    n.setContractNo(IMPORT_NO_PREFIX + String.format("%03d", nextNo++));
                    n.setTenantId(t.getId());
                    n.setBuildingId(prev.getBuildingId());
                    n.setUnitId(prev.getUnitId());
                    n.setStatus("active");     // 无默认值列,插入前必给;真值下面按是否末期覆写
                    n.setRentArea(BigDecimal.ZERO);
                    n.setMonthlyRent(BigDecimal.ZERO);
                    n.setDeposit(BigDecimal.ZERO);
                    contracts.insert(n);
                    created++;
                } else matched++;
                claimed.add(n.getId());
                n.setParentContractId(prev.getId());
                n.setLinkType("renew");   // V57 链接类型(ESCALATION-SPLIT-SPEC §1)
                n.setStartDate(tm.startDate());
                n.setEndDate(tm.endDate());
                n.setTermType("multiple");
                // 末期 = 当前在执行(展示态由 endDate 派生);中间期已被下一期取代
                n.setStatus(k == chain.size() - 1 ? "active" : "renewed");
                // 空值不覆盖既有(updateStrategy=ALWAYS 会写 null,重导不能擦人工补录的原文/备注)
                if (blankToNull(tm.text()) != null) n.setTermText(tm.text().trim());
                // 后续期无明细可挂:原文带金额则记 remark 待补,不臆造计费行(计费行为空 = 待录)
                if (blankToNull(tm.amountNote()) != null) n.setRemark("续签金额待补:" + tm.amountNote().trim());
                // 子期无明细可挂(Term 不带 lines)→ 清掉历史误落的 import 行并重算标量,孤儿行重导即自愈;manual 手录保留
                replaceImportLines(n, null);
                contracts.updateById(n);
                report.add(new ContractFullImportRequest.Item(i, label, t.getId(), n.getId(), n.getContractNo(),
                    isNew ? "created" : "matched", "续签链第" + (k + 1) + "期"));
                prev = n;
            }
        }
        return new ContractFullImportRequest.Result(
            new ImportResultDTO(matched + created, errors.size(), errors), matched, created, report);
    }

    /** 行级前置校验(期限类型枚举 + 续签链各期起止 + 计费行枚举/钉死集/负值);返回中文错误或 null。 */
    private static String rowError(ContractFullImportRequest.Row r) {
        String tt = blankToNull(r.termType());
        if (tt != null && !TERM_TYPES.contains(tt.trim())) return "期限类型非法: " + tt;
        if (r.startDate() != null && r.endDate() != null && r.endDate().isBefore(r.startDate()))
            return "结束日期不能早于开始日期";
        if (r.terms() != null)
            for (ContractFullImportRequest.Term tm : r.terms()) {
                if (tm.startDate() == null || tm.endDate() == null) return "续签链某期起止为空";
                if (tm.endDate().isBefore(tm.startDate())) return "续签链某期结束日期早于开始日期";
            }
        return validateLines(r.lines());
    }

    /** 续签链幂等键:同租户 + 同起租日 = 同一期(首期被标 renewed 后已不在 owned 里)。 */
    private Contract findByStart(Integer tenantId, LocalDate start) {
        if (start == null) return null;
        return contracts.selectList(new QueryWrapper<Contract>()
            .eq("tenant_id", tenantId).eq("start_date", start).orderByAsc("id"))
            .stream().findFirst().orElse(null);
    }

    /** 租户匹配:企业全称精确 → 简称精确(均含别名,V86);同名多户用「期」去歧义,仍不唯一则不匹配(交由行级错误)。 */
    private static Tenant matchTenant(List<Tenant> all, ContractFullImportRequest.Row r) {
        Tenant t = pickTenant(all, r.tenantFullName(), r.phase());
        return t != null ? t : pickTenant(all, r.tenantName(), r.phase());
    }

    private static Tenant pickTenant(List<Tenant> all, String name, Integer phase) {
        if (blankToNull(name) == null) return null;
        String n = name.trim();
        List<Tenant> hit = all.stream().filter(t -> TenantService.matchNames(t).contains(n)).toList();
        if (hit.size() > 1 && phase != null)
            hit = hit.stream().filter(t -> phase.equals(t.getPhase())).toList();
        return hit.size() == 1 ? hit.get(0) : null;
    }

    /** 楼栋匹配(仅新建合同用):楼栋名去「N期」前缀后的核心词出现在物业位置原文里,最长命中优先;
     *  未命中则退化为同期首栋(id 最小);无期或该期无楼栋 → null 交行级错误。 */
    private static Integer resolveBuilding(List<Building> all, String hint, Integer phase) {
        List<Building> pool = phase == null ? all
            : all.stream().filter(b -> phase.equals(b.getPhase())).toList();
        if (pool.isEmpty()) return null;
        String h = hint == null ? "" : hint.trim();
        Building best = null;
        for (Building b : pool) {
            String core = buildingCore(b);
            if (core.isEmpty() || !h.contains(core)) continue;
            if (best == null || core.length() > buildingCore(best).length()) best = b;
        }
        return best != null ? best.getId()
            : pool.stream().min(Comparator.comparing(Building::getId)).map(Building::getId).orElse(null);
    }

    private static String buildingCore(Building b) {
        return b.getName() == null ? "" : b.getName().replaceFirst("^[一二三四五六七八九十]+期\\s*", "").trim();
    }

    /** 自动建合同编号序:取既有 C2024M-### 最大序号 +1。 */
    private int nextImportNoSeq() {
        int max = 0;
        for (Contract c : contracts.selectList(new QueryWrapper<Contract>()
                .likeRight("contract_no", IMPORT_NO_PREFIX))) {
            try { max = Math.max(max, Integer.parseInt(c.getContractNo().substring(IMPORT_NO_PREFIX.length()))); }
            catch (NumberFormatException ignore) { /* 人工改过的号,不参与排序 */ }
        }
        return max + 1;
    }

    // ─── 计费行枚举/受控字段(§1.1,前后端共享契约) ────────────
    static final Set<String> FEE_KEYS = Set.of(
        "rent_factory","rent_office","rent_dorm","rent_shop","rent_land",
        "mgmt","infra","elevator","transformer","access","network","land_tax","other");

    // ─── 类型钉死允许集(§7.1,PINNED ∪ COND ∪ OPTIONAL[land_tax]) ────────────
    static final Set<String> PROPERTY_TYPES = Set.of("factory","office","dorm","shop","land");
    // other=兜底杂费,任何段类型都收(2026-08-05 报障:导入存量含 other 的合同一编辑就 400 保存不了)
    private static final Map<String,Set<String>> ALLOWED_FEES = Map.of(
        "factory", Set.of("rent_factory","mgmt","infra","elevator","transformer","land_tax","other"),
        // office/land 补 infra:旭化成纸约实证「办公室基础设施维护费」1373.11 与消防通道(land)基础设施费 323.46
        "office",  Set.of("rent_office","mgmt","infra","elevator","transformer","land_tax","other"),
        "dorm",    Set.of("rent_dorm","infra","access","network","land_tax","other"),
        "shop",    Set.of("rent_shop","infra","mgmt","transformer","land_tax","other"),
        "land",    Set.of("rent_land","infra","land_tax","other"));
    private static final Set<String> RENT_KEYS = Set.of(
        "rent_factory","rent_office","rent_dorm","rent_shop","rent_land");
    // 建筑类租金(计入租赁面积);rent_land=空地租金单列不入(裁定 2026-07-24);包级开放给 AllocService 分摊面积口径(S5 §1)
    static final Set<String> BUILDING_RENT_KEYS = Set.of(
        "rent_factory","rent_office","rent_dorm","rent_shop");
    // S15:非宿舍建筑类租金(= BUILDING_RENT_KEYS − rent_dorm)。合同级 rent_area 缓存与楼栋面积回退口径用它;
    // 分摊面积(S5 §1,BillNoticeService/AllocService)仍按全集——宿舍户也分摊,是否改子集由引擎侧裁定。
    static final Set<String> NONDORM_RENT_KEYS = Set.of(
        "rent_factory","rent_office","rent_shop");
    private static final Map<String,String> FEE_NAME = Map.ofEntries(
        Map.entry("rent_factory","厂房租金"), Map.entry("rent_office","办公室租金"),
        Map.entry("rent_dorm","宿舍租金"), Map.entry("rent_shop","商铺租金"),
        Map.entry("rent_land","空地租金"), Map.entry("mgmt","企业管理服务费"),
        Map.entry("infra","基础设施维护费"), Map.entry("elevator","电梯维护费"),
        Map.entry("transformer","变压器维护费"), Map.entry("access","门禁设施维护费"),
        Map.entry("network","网络通讯费"), Map.entry("land_tax","土地使用税"),
        Map.entry("other","其他费用"));

    /** 上下文显示名(§7.2 LABEL[propertyType][feeKey]):mgmt/infra 随段类型加前缀,其余同 FEE_NAME。 */
    static String feeLabel(String propertyType, String feeKey) {
        if ("mgmt".equals(feeKey) || "infra".equals(feeKey)) {
            String prefix = switch (propertyType == null ? "" : propertyType) {
                case "factory" -> "厂房"; case "office" -> "办公室";
                case "dorm" -> "宿舍"; case "shop" -> "商铺"; default -> "";
            };
            return prefix + ("mgmt".equals(feeKey) ? "企业管理服务费" : "基础设施维护费");
        }
        return FEE_NAME.getOrDefault(feeKey, feeKey);
    }

    /** 展示态派生(§5.1):draft/terminated/renewed 人工态透传;active 据起止日与今天(Asia/Shanghai)派生。
     *  status 只存人工态,时间态(future/expiring/expired)全部在此派生(裁定 2026-07-28)。 */
    static String effectiveStatus(String stored, LocalDate startDate, LocalDate endDate) {
        if (!"active".equals(stored)) return stored;          // draft/terminated/renewed 及历史 expiring 透传
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        if (startDate != null && startDate.isAfter(today)) return "future";   // 已签未起租,不算在租
        if (endDate == null) return "active";                 // 无到期日视为在租
        if (today.isAfter(endDate)) return "expired";
        return ChronoUnit.DAYS.between(today, endDate) <= 90 ? "expiring" : "active";
    }

    /** feeKey 默认计费方式(§1.1):按间年/月、固定月额、面积×单价×系数。 */
    private static String defaultBillMode(String feeKey) {
        return switch (feeKey) {
            case "access" -> "per_room_year";
            case "network" -> "per_room_month";
            case "elevator", "transformer", "land_tax", "other" -> "per_month";
            default -> "per_sqm_month";   // rent_* + mgmt + infra
        };
    }

    private static String defaultLocation(String loc) {
        return blankToNull(loc) == null ? "主" : loc.trim();
    }

    /** 计费行组校验:feeKey ∈ 13 枚举、面积/单价/月额 ≥0、propertyType 非空则钉死集越界拒绝(§7.1)。
     *  返回中文错误或 null(含 null 列表=清空);导入路径按行级跳过,不整批拦。 */
    private static String validateLines(List<BillingLinesImportRequest.Line> lines) {
        if (lines == null) return null;
        for (BillingLinesImportRequest.Line l : lines) {
            if (l.feeKey() == null || !FEE_KEYS.contains(l.feeKey())) return "费项类型非法: " + l.feeKey();
            String pt = blankToNull(l.propertyType());
            if (pt != null) {
                if (!PROPERTY_TYPES.contains(pt)) return "物业类型非法: " + pt;
                if (!ALLOWED_FEES.get(pt).contains(l.feeKey()))
                    return "费项 " + l.feeKey() + " 不属于「" + pt + "」段类型";
            }
            for (BigDecimal v : new BigDecimal[]{ l.area(), l.areaShared(), l.unitPrice(), l.amountOverride() })
                if (v != null && v.signum() < 0) return "金额/面积必须 ≥ 0";
        }
        return null;
    }

    /** 写路径(create/update)计费行校验:非法枚举 → 400;propertyType 非空则钉死校验 feeKey 越界 → 400(§2/§7.1)。
     *  ponytail: propertyType 可空(兼容遗留/导入无段类型的行);给了段类型就钉死,禁越界。 */
    private static void validateLinesOrThrow(List<BillingLineReq> lines) {
        if (lines == null) return;
        for (BillingLineReq l : lines) {
            if (l.feeKey() == null || !FEE_KEYS.contains(l.feeKey()))
                throw new BizException(ResultCode.BAD_REQUEST, "费项类型非法: " + l.feeKey());
            String pt = blankToNull(l.propertyType());
            if (pt != null) {
                if (!PROPERTY_TYPES.contains(pt))
                    throw new BizException(ResultCode.BAD_REQUEST, "物业类型非法: " + pt);
                if (!ALLOWED_FEES.get(pt).contains(l.feeKey()))
                    throw new BizException(ResultCode.BAD_REQUEST, "费项 " + l.feeKey() + " 不属于「" + pt + "」段类型");
            }
        }
    }

    /** 计费行整组替换(单一编辑 PUT):删旧全组、插新组;同 id 行沿旧 source,新行标 manual。
     *  S15 孤儿雷修复:billing_term_unit 行级绑定挂在 term id 上,delete+insert 重建会经 FK CASCADE
     *  连带清光(dev 库 1708 行绑定)。重建前按 (location|feeKey|area) 键快照旧行绑定,重建后按同键
     *  回挂到新 term id;键撞多行按 (seq,id)↔插入序 配对,配不上的绑定随 CASCADE 删除并在返回警告点名。 */
    private List<String> replaceLinesFromReq(Integer contractId, List<BillingLineReq> lines, Map<Integer,String> oldSrc) {
        List<ContractBillingTerm> oldTerms = terms.selectList(
            new QueryWrapper<ContractBillingTerm>().eq("contract_id", contractId).orderByAsc("seq", "id"));
        Map<Integer, List<BillingTermUnit>> bindsByTerm = oldTerms.isEmpty() ? Map.of()
            : termUnits.selectList(new QueryWrapper<BillingTermUnit>()
                    .in("term_id", oldTerms.stream().map(ContractBillingTerm::getId).toList()))
                .stream().collect(Collectors.groupingBy(BillingTermUnit::getTermId));
        Map<String, Deque<List<BillingTermUnit>>> snapshot = new LinkedHashMap<>();
        for (ContractBillingTerm t : oldTerms) {
            List<BillingTermUnit> b = bindsByTerm.get(t.getId());
            if (b != null) snapshot.computeIfAbsent(bindKey(t.getLocation(), t.getFeeKey(), t.getArea()),
                k -> new ArrayDeque<>()).add(b);
        }

        terms.delete(new QueryWrapper<ContractBillingTerm>().eq("contract_id", contractId));
        int idx = 0;
        List<ContractBillingTerm> inserted = new ArrayList<>();
        for (BillingLineReq l : lines) {
            ContractBillingTerm t = new ContractBillingTerm();
            t.setContractId(contractId);
            t.setPropertyType(blankToNull(l.propertyType()));
            t.setLocation(defaultLocation(l.location()));
            t.setFeeKey(l.feeKey());
            t.setFeeName(feeLabel(l.propertyType(), l.feeKey()));
            t.setBillMode(blankToNull(l.billMode()) == null ? defaultBillMode(l.feeKey()) : l.billMode());
            t.setArea(l.area());
            t.setAreaShared(l.areaShared());
            t.setUnitPrice(l.unitPrice() == null ? BigDecimal.ZERO : l.unitPrice());
            t.setCoeff(l.coeff() == null ? BigDecimal.ONE : l.coeff());
            t.setRoomCount(l.roomCount());
            t.setAmountOverride(l.amountOverride());
            t.setSeq(l.seq() != null ? l.seq() : idx);
            t.setSource(l.id() != null && oldSrc.containsKey(l.id()) ? oldSrc.get(l.id()) : "manual");
            terms.insert(t);
            inserted.add(t);
            idx++;
        }
        // 回挂:新行按插入序领取同键快照组(键撞多行 → 队列按序配对)
        for (ContractBillingTerm t : inserted) {
            Deque<List<BillingTermUnit>> q = snapshot.get(bindKey(t.getLocation(), t.getFeeKey(), t.getArea()));
            if (q == null || q.isEmpty()) continue;
            for (BillingTermUnit old : q.poll()) {
                BillingTermUnit nb = new BillingTermUnit();
                nb.setTermId(t.getId()); nb.setUnitId(old.getUnitId()); nb.setSource(old.getSource());
                termUnits.insert(nb);
            }
        }
        List<String> warnings = new ArrayList<>();
        snapshot.forEach((key, q) -> q.forEach(b -> warnings.add(
            "计费行 " + key + " 被删除,其 " + b.size() + " 个单元绑定已随之删除")));
        return warnings;
    }

    /** 绑定回挂键(S15):行的 (location|feeKey|area),area 归一(stripTrailingZeros)同 dedupAreaSum。 */
    private static String bindKey(String location, String feeKey, BigDecimal area) {
        return location + "|" + feeKey + "|"
            + (area == null ? "-" : area.stripTrailingZeros().toPlainString());
    }

    /** 五标量只读缓存 = 从计费行反向同步(§1.1):主行=同类 seq 最小者;无该类行则不动缓存。
     *  rentArea(裁定 2026-07-24):不再独立录入,= 建筑类租金行面积之和(多位置加总,空地不计);
     *  buildingArea = rentArea×0.8 从此派生(ALWAYS 重算,rentArea=0 则清空)。
     *  两口径修正(2026-07-24):①面积按 (location,feeKey,area) 三元完全去重后求和,消除同一行被重复录入的翻倍;
     *  ②仅当整个合同一条建筑租金行都没有时,rentArea 回退=infra 行面积(同三元去重)——防二期只有 infra 带面积的户丢面积;
     *  有任一租金行则 infra 完全不参与(翔海式:infra 面积是整栋维护合计,绝不能加进租赁面积)。 */
    /** 单行月额,镜像前端 lineMonthly(types/contract.ts §1.1);缺参数返回 null=待录。 */
    static BigDecimal lineMonthly(ContractBillingTerm l, BigDecimal kva) {
        String mode = l.getBillMode() == null ? "" : l.getBillMode();
        BigDecimal up = l.getUnitPrice(), area = l.getArea(), coeff = l.getCoeff();
        Integer rooms = l.getRoomCount();
        return switch (mode) {
            case "per_sqm_month" -> (area == null || up == null) ? null
                : area.multiply(up).multiply(coeff == null ? BigDecimal.ONE : coeff).setScale(2, RoundingMode.HALF_UP);
            case "per_room_year" -> (up == null || rooms == null) ? null
                : up.multiply(BigDecimal.valueOf(rooms)).divide(BigDecimal.valueOf(12), 2, RoundingMode.HALF_UP);
            case "per_room_month" -> (up == null || rooms == null) ? null
                : up.multiply(BigDecimal.valueOf(rooms)).setScale(2, RoundingMode.HALF_UP);
            case "per_kva_month" -> kva == null ? null : kva.setScale(2, RoundingMode.HALF_UP);
            default -> l.getAmountOverride();
        };
    }

    private void syncScalarCache(Contract c) {
        List<ContractBillingTerm> lines = terms.selectList(
            new QueryWrapper<ContractBillingTerm>().eq("contract_id", c.getId()).orderByAsc("seq", "id"));
        // monthlyRent=Σ lineMonthly(V58 起单一事实源=计费行);行清空=待录=0(重导清子期孤儿行同款语义)
        c.setMonthlyRent(lines.stream().map(l -> lineMonthly(l, c.getKva()))
            .filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add));
        // S15:rent_area 改为非宿舍行Σ(宿舍间面积走单元绑定口径,不入合同级租赁面积);
        // hasRentLine 仍按全集判——纯宿舍户不得回退 infra(宿舍行只是不计面积,不是没租金行)
        boolean hasRentLine = lines.stream().anyMatch(l -> BUILDING_RENT_KEYS.contains(l.getFeeKey()));
        BigDecimal rentArea = hasRentLine
            ? dedupAreaSum(lines, NONDORM_RENT_KEYS)
            : dedupAreaSum(lines, Set.of("infra"));
        c.setRentArea(rentArea);
        c.setBuildingArea(rentArea.signum() > 0
            ? rentArea.multiply(new BigDecimal("0.8")).setScale(2, RoundingMode.HALF_UP) : null);
        lines.stream().filter(l -> "per_sqm_month".equals(l.getBillMode()) && RENT_KEYS.contains(l.getFeeKey()))
            .findFirst().ifPresent(l -> c.setUnitPrice(l.getUnitPrice()));
        lines.stream().filter(l -> "mgmt".equals(l.getFeeKey()))
            .findFirst().ifPresent(l -> c.setMgmtFeePrice(l.getUnitPrice()));
        lines.stream().filter(l -> "infra".equals(l.getFeeKey()))
            .findFirst().ifPresent(l -> c.setInfraFeePrice(l.getUnitPrice()));
        lines.stream().filter(l -> "elevator".equals(l.getFeeKey()))
            .findFirst().ifPresent(l -> c.setElevatorFee(l.getAmountOverride()));
        lines.stream().filter(l -> "transformer".equals(l.getFeeKey()))
            .findFirst().ifPresent(l -> c.setTransformerFee(l.getAmountOverride()));
    }

    /** 指定 feeKey 集合内的行按 (location,feeKey,area) 三元完全去重后求面积和。
     *  area 归一(stripTrailingZeros)保证 3200 与 3200.00 视为同值;location/area 不同的合理多位置行照常各计。
     *  包级开放(S15):BuildingService 面积派生回退口径复用。 */
    static BigDecimal dedupAreaSum(List<ContractBillingTerm> lines, Set<String> feeKeys) {
        Set<String> seen = new HashSet<>();
        BigDecimal sum = BigDecimal.ZERO;
        for (ContractBillingTerm l : lines) {
            if (!feeKeys.contains(l.getFeeKey())) continue;
            BigDecimal area = l.getArea() == null ? BigDecimal.ZERO : l.getArea();
            String key = l.getLocation() + "|" + l.getFeeKey() + "|" + area.stripTrailingZeros().toPlainString();
            if (seen.add(key)) sum = sum.add(area);
        }
        return sum;
    }

    /** 计费行读出(按 property_type, location, seq 排序,§7.2),供 detail 段分组带出。
     *  feeName 读侧按 (propertyType, feeKey) 上下文重算,回显始终一致。 */
    private List<BillingLineDTO> loadLines(Integer contractId) {
        return terms.selectList(new QueryWrapper<ContractBillingTerm>()
                // 按 location 分组内 seq 排(seq 每场地各自起算)。曾以 property_type 首排:MySQL NULL 靠前,
                // 把 property_type 为空的 infra 行顶到卡片最上并与同场地租金行拆成两个段带(2026-07-29 修)。
                .eq("contract_id", contractId).orderByAsc("location", "seq", "id")).stream()
            .map(t -> new BillingLineDTO(t.getId(), t.getContractId(), t.getPropertyType(), t.getLocation(),
                t.getFeeKey(), feeLabel(t.getPropertyType(), t.getFeeKey()), t.getArea(), t.getAreaShared(), t.getUnitPrice(), t.getCoeff(),
                t.getRoomCount(), t.getBillMode(), t.getAmountOverride(), t.getSeq(), t.getSource()))
            .toList();
    }

    // 阶梯期读写口已删(ESCALATION-SPLIT-SPEC):阶梯语义由 escalation 链表达;
    // contract_rent_tier 表暂留(云端跑完拆链前不 DROP,§5),代码零引用。

    // ─── fee_src 字段级来源映射(JSON 列) ─────────────────────

    private static final TypeReference<LinkedHashMap<String,String>> SRC_TYPE = new TypeReference<>() {};

    private static Map<String,String> readFeeSrc(Contract c) {
        if (c.getFeeSrc() == null || c.getFeeSrc().isBlank()) return new LinkedHashMap<>();
        try { return JSON.readValue(c.getFeeSrc(), SRC_TYPE); }
        catch (JsonProcessingException e) { return new LinkedHashMap<>(); }   // 坏数据按空,后续写回修复
    }

    private static String writeFeeSrc(Map<String,String> src) {
        if (src.isEmpty()) return null;
        try { return JSON.writeValueAsString(src); }
        catch (JsonProcessingException e) { return null; }
    }

    private static void markManualIfChanged(Map<String,String> src, String key, BigDecimal oldV, BigDecimal newV) {
        boolean changed = (oldV == null) != (newV == null)
            || (oldV != null && newV != null && oldV.compareTo(newV) != 0);
        if (changed) src.put(key, "manual");
    }

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

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
        if (req.extraUnitIds() != null) {
            for (Integer uid : req.extraUnitIds()) {
                if (Objects.equals(uid, req.unitId()))
                    throw new BizException(ResultCode.CONFLICT, "附加单元不能与主单元重复");
                // S15:附加单元放开跨栋(宿舍527式:厂房主栋合同带跨栋宿舍间),单元存在即可;主单元仍限同栋
                if (uid == null || units.selectById(uid) == null)
                    throw new BizException(ResultCode.CONFLICT, "附加单元不存在");
            }
        }
        if (req.startDate() != null && req.endDate() != null && req.endDate().isBefore(req.startDate()))
            throw new BizException(ResultCode.CONFLICT, "结束日期不能早于开始日期");
        // 用电分类不锁配电容量(用户拍板 2026-07-27,推翻裁定④):非大工业户也有报装 kVA,
        // 2024-02 水电册实证(A座商业户旭化成400/鑫皇118.75、宿舍商铺雷少康26 均收容量费)
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
        BigDecimal ra = req.rentArea() != null ? req.rentArea() : BigDecimal.ZERO;
        c.setRentArea(ra);
        c.setMonthlyRent(req.monthlyRent() != null ? req.monthlyRent() : BigDecimal.ZERO);
        c.setDeposit(req.deposit() != null ? req.deposit() : BigDecimal.ZERO);
        c.setStartDate(req.startDate());
        c.setEndDate(req.endDate());
        c.setSignDate(req.signDate());
        c.setStatus(req.status());
        c.setRemark(req.remark());
        // 建筑面积清空重算(裁定①):留空/清空 = 租赁面积×0.8 派生;显式填值尊重不覆盖(V33 联动方向:租赁面积主档)
        c.setBuildingArea(req.buildingArea() != null ? req.buildingArea()
            : ra.signum() > 0 ? ra.multiply(new BigDecimal("0.8")).setScale(2, RoundingMode.HALF_UP) : null);
        c.setUnitPrice(req.unitPrice());
        // V51 五费项+电费要素(空=待录)
        c.setMgmtFeePrice(req.mgmtFeePrice());
        c.setInfraFeePrice(req.infraFeePrice());
        c.setElevatorCount(req.elevatorCount());
        c.setElevatorFloors(req.elevatorFloors());
        c.setElevatorFee(req.elevatorFee());
        c.setTransformerFee(req.transformerFee());
        c.setPowerType(blankToNull(req.powerType()));
        c.setKva(req.kva());
        c.setRentFree(req.rentFree() == null || req.rentFree().isBlank() ? null : req.rentFree());
        // V55 期限原文三件套(PUT 全字段语义:置空即清空)
        c.setTermText(blankToNull(req.termText()));
        c.setTermType(blankToNull(req.termType()));
        c.setTierPriceNote(blankToNull(req.tierPriceNote()));
    }

    /** 单条回显:按 id 点查租户/楼栋/单元拼 DTO(写路径共用)。 */
    private ContractDTO dtoOf(Contract c) { return dtoOf(c, null); }

    private ContractDTO dtoOf(Contract c, List<String> warnings) {
        Tenant t = tenants.selectById(c.getTenantId());
        Building b = buildings.selectById(c.getBuildingId());
        Unit u = c.getUnitId() != null ? units.selectById(c.getUnitId()) : null;
        Map<Integer,String> uFloor = (u != null && u.getFloor() != null && u.getUnitNo() != null)
            ? Map.of(u.getId(), u.getFloor() + "F-" + u.getUnitNo()) : Map.of();
        return toDTO(c,
            t != null ? Map.of(t.getId(), t.getCompanyName()) : Map.of(),
            b != null ? Map.of(b.getId(), b.getName()) : Map.of(),
            uFloor, extraUnitCounts(), warnings);
    }

    /** 全表附加单元计数 contract_id→N(V58);list/detail/dtoOf 组装 DTO 前取一次。 */
    private Map<Integer, Long> extraUnitCounts() {
        return contractUnits.selectList(null).stream().collect(
            Collectors.groupingBy(ContractUnit::getContractId, Collectors.counting()));
    }

    // ponytail: shared derivation — list() and detail() both call this
    private ContractDTO toDTO(Contract c, Map<Integer,String> tName,
                              Map<Integer,String> bName, Map<Integer,String> uFloor,
                              Map<Integer,Long> extraUnits) {
        return toDTO(c, tName, bName, uFloor, extraUnits, null);
    }

    private ContractDTO toDTO(Contract c, Map<Integer,String> tName,
                              Map<Integer,String> bName, Map<Integer,String> uFloor,
                              Map<Integer,Long> extraUnits, List<String> warnings) {
        int termMonths = (c.getStartDate() != null && c.getEndDate() != null)
            ? (int) ChronoUnit.MONTHS.between(c.getStartDate(), c.getEndDate()) : 0;
        Integer daysToEnd = c.getEndDate() != null
            ? (int) ChronoUnit.DAYS.between(LocalDate.now(ZoneId.of("Asia/Shanghai")), c.getEndDate()) : null;
        String floorInfo = c.getUnitId() != null ? uFloor.getOrDefault(c.getUnitId(), "") : "";
        // V58 附加单元:一份合同占多单元时主单元后缀「等N单元」(如 3F-301 等5单元)
        long extra = extraUnits.getOrDefault(c.getId(), 0L);
        if (!floorInfo.isEmpty() && extra > 0) floorInfo += " 等" + (extra + 1) + "单元";
        return new ContractDTO(
            c.getId(), c.getContractNo(),
            c.getTenantId(), tName.getOrDefault(c.getTenantId(), ""),
            c.getBuildingId(), bName.getOrDefault(c.getBuildingId(), ""),
            c.getUnitId(), floorInfo,
            c.getBuildingArea(), c.getRentArea(), c.getUnitPrice(),
            c.getMgmtFeePrice(), c.getInfraFeePrice(),
            c.getElevatorCount(), c.getElevatorFloors(), c.getElevatorFee(), c.getTransformerFee(),
            c.getPowerType(), c.getKva(),
            c.getMonthlyRent(), c.getDeposit(),
            c.getStartDate() != null ? c.getStartDate().toString() : null,
            c.getEndDate()   != null ? c.getEndDate().toString()   : null,
            c.getSignDate()  != null ? c.getSignDate().toString()  : null,
            effectiveStatus(c.getStatus(), c.getStartDate(), c.getEndDate()),   // 展示态派生桶(§5.1)
            c.getParentContractId(), c.getLinkType(), c.getKind(),
            termMonths, daysToEnd, c.getRemark(), c.getRentFree(),
            c.getTermText(), c.getTermType(), c.getTierPriceNote(),   // V55 期限原文必现
            warnings   // S15:绑定回挂告警(仅写路径)
        );
    }
}
