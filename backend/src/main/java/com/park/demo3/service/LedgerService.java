package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.LedgerMonthDTO;
import com.park.demo3.dto.LedgerMonthDTO.LedgerFooter;
import com.park.demo3.dto.LedgerMonthDTO.LedgerRowDTO;
import com.park.demo3.dto.LedgerOverviewDTO;
import com.park.demo3.dto.LedgerOverviewDTO.MonthMeta;
import com.park.demo3.dto.LedgerSaveRequest;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.LedgerImportRequest;
import com.park.demo3.dto.YearMonthsDTO;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.TenantMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class LedgerService {
    private final MonthlyLedgerMapper ledger;
    private final ManagementCompanyMapper companies;
    private final TenantMapper tenants;

    public LedgerService(MonthlyLedgerMapper ledger, ManagementCompanyMapper companies, TenantMapper tenants) {
        this.ledger = ledger; this.companies = companies; this.tenants = tenants;
    }

    // 21 费用列读取器(顺序同 §3.1)
    private static final List<Function<MonthlyLedger, BigDecimal>> FEE_GET = List.of(
        MonthlyLedger::getFactoryRent, MonthlyLedger::getFactoryMgmtFee,
        MonthlyLedger::getShopRent, MonthlyLedger::getDormRent,
        MonthlyLedger::getDormFacilitiesFee, MonthlyLedger::getShopMgmtFee,
        MonthlyLedger::getFactoryInfraMaint, MonthlyLedger::getShopInfraMaint,
        MonthlyLedger::getDormInfraMaint,
        MonthlyLedger::getElevatorMaint, MonthlyLedger::getTransformerMaint,
        MonthlyLedger::getLandUseTax, MonthlyLedger::getNetworkFee,
        MonthlyLedger::getAccessCtrlMaint, MonthlyLedger::getOfficeOtherFee,
        MonthlyLedger::getDormOtherFee,
        MonthlyLedger::getBasicElectricity, MonthlyLedger::getStandardElectricity,
        MonthlyLedger::getElectricityMaint,
        MonthlyLedger::getStandardWater, MonthlyLedger::getWaterMaint);

    private static final List<BiConsumer<MonthlyLedger, BigDecimal>> FEE_SET = List.of(
        MonthlyLedger::setFactoryRent, MonthlyLedger::setFactoryMgmtFee,
        MonthlyLedger::setShopRent, MonthlyLedger::setDormRent,
        MonthlyLedger::setDormFacilitiesFee, MonthlyLedger::setShopMgmtFee,
        MonthlyLedger::setFactoryInfraMaint, MonthlyLedger::setShopInfraMaint,
        MonthlyLedger::setDormInfraMaint,
        MonthlyLedger::setElevatorMaint, MonthlyLedger::setTransformerMaint,
        MonthlyLedger::setLandUseTax, MonthlyLedger::setNetworkFee,
        MonthlyLedger::setAccessCtrlMaint, MonthlyLedger::setOfficeOtherFee,
        MonthlyLedger::setDormOtherFee,
        MonthlyLedger::setBasicElectricity, MonthlyLedger::setStandardElectricity,
        MonthlyLedger::setElectricityMaint,
        MonthlyLedger::setStandardWater, MonthlyLedger::setWaterMaint);

    // request 行的 21 费用读取器(同序)
    private static final List<Function<LedgerSaveRequest.Row, BigDecimal>> REQ_GET = List.of(
        LedgerSaveRequest.Row::factoryRent, LedgerSaveRequest.Row::factoryMgmtFee,
        LedgerSaveRequest.Row::shopRent, LedgerSaveRequest.Row::dormRent,
        LedgerSaveRequest.Row::dormFacilitiesFee, LedgerSaveRequest.Row::shopMgmtFee,
        LedgerSaveRequest.Row::factoryInfraMaint, LedgerSaveRequest.Row::shopInfraMaint,
        LedgerSaveRequest.Row::dormInfraMaint,
        LedgerSaveRequest.Row::elevatorMaint, LedgerSaveRequest.Row::transformerMaint,
        LedgerSaveRequest.Row::landUseTax, LedgerSaveRequest.Row::networkFee,
        LedgerSaveRequest.Row::accessCtrlMaint, LedgerSaveRequest.Row::officeOtherFee,
        LedgerSaveRequest.Row::dormOtherFee,
        LedgerSaveRequest.Row::basicElectricity, LedgerSaveRequest.Row::standardElectricity,
        LedgerSaveRequest.Row::electricityMaint,
        LedgerSaveRequest.Row::standardWater, LedgerSaveRequest.Row::waterMaint);

    // import 行的 21 费用读取器(同序),用于逐行定向 upsert(走 FEE_SET)
    private static final List<Function<LedgerImportRequest.Row, BigDecimal>> IMP_GET = List.of(
        LedgerImportRequest.Row::factoryRent, LedgerImportRequest.Row::factoryMgmtFee,
        LedgerImportRequest.Row::shopRent, LedgerImportRequest.Row::dormRent,
        LedgerImportRequest.Row::dormFacilitiesFee, LedgerImportRequest.Row::shopMgmtFee,
        LedgerImportRequest.Row::factoryInfraMaint, LedgerImportRequest.Row::shopInfraMaint,
        LedgerImportRequest.Row::dormInfraMaint,
        LedgerImportRequest.Row::elevatorMaint, LedgerImportRequest.Row::transformerMaint,
        LedgerImportRequest.Row::landUseTax, LedgerImportRequest.Row::networkFee,
        LedgerImportRequest.Row::accessCtrlMaint, LedgerImportRequest.Row::officeOtherFee,
        LedgerImportRequest.Row::dormOtherFee,
        LedgerImportRequest.Row::basicElectricity, LedgerImportRequest.Row::standardElectricity,
        LedgerImportRequest.Row::electricityMaint,
        LedgerImportRequest.Row::standardWater, LedgerImportRequest.Row::waterMaint);

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }

    // 共享派生:返回 [totalReceivable, balanceEnd]
    static BigDecimal[] recalc(MonthlyLedger l) {
        BigDecimal recv = BigDecimal.ZERO;
        for (var g : FEE_GET) recv = recv.add(nz(g.apply(l)));
        BigDecimal end = nz(l.getBalancePrev()).add(recv).subtract(nz(l.getTotalCollected()));
        return new BigDecimal[]{ recv.setScale(2, RoundingMode.HALF_UP), end.setScale(2, RoundingMode.HALF_UP) };
    }

    // ── 年份门:有数据的年份 + 各年已录入月份数 ──
    public List<YearMonthsDTO> years(Integer companyId) {
        if (companies.selectById(companyId) == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        return ledger.yearsWithMonths(companyId).stream()
            .map(m -> new YearMonthsDTO(((Number) m.get("year")).intValue(), ((Number) m.get("months")).intValue()))
            .toList();
    }

    // ── overview ──
    public LedgerOverviewDTO overview(Integer companyId, int year) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        Map<Integer, List<MonthlyLedger>> byMonth = ledger.selectYear(companyId, year).stream()
            .collect(Collectors.groupingBy(MonthlyLedger::getPeriodMonth));

        int maxMonth = byMonth.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);

        List<MonthMeta> months = new ArrayList<>(12);
        BigDecimal ytd = BigDecimal.ZERO;
        int monthsWithData = 0;
        for (int m = 1; m <= 12; m++) {
            List<MonthlyLedger> rows = byMonth.get(m);
            if (rows == null || rows.isEmpty()) {
                months.add(new MonthMeta(m, BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), 0, "empty"));
                continue;
            }
            monthsWithData++;
            BigDecimal recv = BigDecimal.ZERO, coll = BigDecimal.ZERO;
            int tenantCount = 0;
            for (MonthlyLedger l : rows) {
                BigDecimal r = recalc(l)[0];
                recv = recv.add(r);
                coll = coll.add(nz(l.getTotalCollected()));
                if (r.signum() > 0) tenantCount++;
            }
            ytd = ytd.add(recv);
            String status = (m == maxMonth) ? "current" : "done";
            months.add(new MonthMeta(m, r2(recv), r2(coll), tenantCount, status));
        }

        BigDecimal avg = monthsWithData == 0 ? BigDecimal.ZERO
            : ytd.divide(BigDecimal.valueOf(monthsWithData), 2, RoundingMode.HALF_UP);
        return new LedgerOverviewDTO(company.getName(), year, monthsWithData,
            r2(ytd), r2(avg), activeTenants().size(), months);
    }

    // ── month read(稀疏补零成全部在租租户) ──
    public LedgerMonthDTO month(Integer companyId, int year, int month) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        List<Tenant> active = activeTenants();
        Map<Integer, MonthlyLedger> stored = ledger.selectMonth(companyId, year, month).stream()
            .collect(Collectors.toMap(MonthlyLedger::getTenantId, l -> l, (a, b) -> a));

        List<LedgerRowDTO> rows = new ArrayList<>(active.size());
        for (Tenant t : active) {
            MonthlyLedger l = stored.get(t.getId());
            if (l == null) l = zeroRow(companyId, t.getId(), year, month);
            rows.add(toRowDTO(l, t.getCompanyName()));
        }
        return new LedgerMonthDTO(company.getName(), year, month, prevMonth(month), rows, footer(rows));
    }

    // ── save(逐行 upsert / 删空,事务) ──
    @Transactional
    public LedgerMonthDTO save(Integer companyId, int year, int month, LedgerSaveRequest req) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        Set<Integer> activeIds = activeTenants().stream().map(Tenant::getId).collect(Collectors.toSet());

        Map<Integer, MonthlyLedger> stored = ledger.selectMonth(companyId, year, month).stream()
            .collect(Collectors.toMap(MonthlyLedger::getTenantId, l -> l, (a, b) -> a));

        for (LedgerSaveRequest.Row row : req.rows()) {
            if (!activeIds.contains(row.tenantId())) continue;
            MonthlyLedger existing = stored.get(row.tenantId());
            if (isBlank(row)) {
                if (existing != null) ledger.deleteById(existing.getId());
                continue;
            }
            MonthlyLedger l = existing != null ? existing
                : zeroRow(companyId, row.tenantId(), year, month);
            applyRow(l, row);
            if (existing != null) ledger.updateById(l); else ledger.insert(l);
        }
        return month(companyId, year, month);
    }

    // ── import(逐行按 tenantName 解析在租租户 → 定向 upsert 21 费用;绝不删未导入租户) ──
    @Transactional
    public ImportResultDTO importRows(Integer companyId, int year, int month, LedgerImportRequest req) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        // 在租租户(status=1)按 company_name 精确匹配
        Map<String, Integer> byName = activeTenants().stream()
            .collect(Collectors.toMap(Tenant::getCompanyName, Tenant::getId, (a, b) -> a));
        Map<Integer, MonthlyLedger> stored = ledger.selectMonth(companyId, year, month).stream()
            .collect(Collectors.toMap(MonthlyLedger::getTenantId, l -> l, (a, b) -> a));

        int imported = 0;
        List<ImportError> errors = new ArrayList<>();
        List<LedgerImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            LedgerImportRequest.Row row = rows.get(i);
            String name = row.tenantName() == null ? null : row.tenantName().trim();
            Integer tenantId = name == null ? null : byName.get(name);
            if (tenantId == null) {
                errors.add(new ImportError(i, row.tenantName(), "未找到匹配在租租户"));
                continue;
            }
            // 定向 upsert:既有行 update,否则 insert(不触碰未导入的其他租户行)
            MonthlyLedger existing = stored.get(tenantId);
            MonthlyLedger l = existing != null ? existing : zeroRow(companyId, tenantId, year, month);
            for (int f = 0; f < FEE_SET.size(); f++) FEE_SET.get(f).accept(l, r2(IMP_GET.get(f).apply(row)));
            if (existing != null) ledger.updateById(l); else ledger.insert(l);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── copy-from-prev(以上月各行为模板,结余结转,事务) ──
    @Transactional
    public LedgerMonthDTO copyFromPrev(Integer companyId, int year, int month) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        int pm = prevMonth(month);
        int py = month == 1 ? year - 1 : year;
        List<MonthlyLedger> prev = ledger.selectMonth(companyId, py, pm);
        if (prev.isEmpty()) throw new BizException(ResultCode.CONFLICT, "上月无台账数据");

        Map<Integer, MonthlyLedger> cur = ledger.selectMonth(companyId, year, month).stream()
            .collect(Collectors.toMap(MonthlyLedger::getTenantId, l -> l, (a, b) -> a));

        for (MonthlyLedger src : prev) {
            MonthlyLedger existing = cur.get(src.getTenantId());
            MonthlyLedger l = existing != null ? existing
                : zeroRow(companyId, src.getTenantId(), year, month);
            // 21 费用照搬
            for (int i = 0; i < FEE_GET.size(); i++) FEE_SET.get(i).accept(l, nz(FEE_GET.get(i).apply(src)));
            l.setBalancePrev(recalc(src)[1]);  // balancePrev := 上月该租户 balanceEnd
            l.setTotalCollected(BigDecimal.ZERO);
            l.setNote(null);
            if (existing != null) ledger.updateById(l); else ledger.insert(l);
        }
        return month(companyId, year, month);
    }

    // ── helpers ──
    private List<Tenant> activeTenants() {
        return tenants.selectList(null).stream()
            .filter(t -> t.getStatus() != null && t.getStatus() == 1)
            .sorted(Comparator.comparing(Tenant::getId))
            .toList();
    }

    private static int prevMonth(int month) { return month == 1 ? 12 : month - 1; }

    private static MonthlyLedger zeroRow(Integer companyId, Integer tenantId, int year, int month) {
        MonthlyLedger l = new MonthlyLedger();
        l.setCompanyId(companyId); l.setTenantId(tenantId);
        l.setPeriodYear(year); l.setPeriodMonth(month);
        for (var s : FEE_SET) s.accept(l, BigDecimal.ZERO);
        l.setBalancePrev(BigDecimal.ZERO);
        l.setTotalCollected(BigDecimal.ZERO);
        l.setNote(null);
        return l;
    }

    private static boolean isBlank(LedgerSaveRequest.Row row) {
        for (var g : REQ_GET) if (nz(g.apply(row)).signum() != 0) return false;
        if (nz(row.balancePrev()).signum() != 0) return false;
        if (nz(row.totalCollected()).signum() != 0) return false;
        return row.note() == null || row.note().isBlank();
    }

    private static void applyRow(MonthlyLedger l, LedgerSaveRequest.Row row) {
        for (int i = 0; i < FEE_SET.size(); i++) FEE_SET.get(i).accept(l, r2(REQ_GET.get(i).apply(row)));
        l.setBalancePrev(r2(row.balancePrev()));
        l.setTotalCollected(r2(row.totalCollected()));
        l.setNote(row.note() == null || row.note().isBlank() ? null : row.note());
    }

    private static LedgerRowDTO toRowDTO(MonthlyLedger l, String tenantName) {
        BigDecimal[] d = recalc(l);
        return new LedgerRowDTO(
            l.getTenantId(), tenantName, r2(l.getBalancePrev()),
            r2(l.getFactoryRent()), r2(l.getFactoryMgmtFee()),
            r2(l.getShopRent()), r2(l.getDormRent()),
            r2(l.getDormFacilitiesFee()), r2(l.getShopMgmtFee()),
            r2(l.getFactoryInfraMaint()), r2(l.getShopInfraMaint()),
            r2(l.getDormInfraMaint()),
            r2(l.getElevatorMaint()), r2(l.getTransformerMaint()),
            r2(l.getLandUseTax()), r2(l.getNetworkFee()),
            r2(l.getAccessCtrlMaint()), r2(l.getOfficeOtherFee()),
            r2(l.getDormOtherFee()),
            r2(l.getBasicElectricity()), r2(l.getStandardElectricity()),
            r2(l.getElectricityMaint()),
            r2(l.getStandardWater()), r2(l.getWaterMaint()),
            r2(l.getTotalCollected()), l.getNote(),
            d[0], d[1]);
    }

    private static LedgerFooter footer(List<LedgerRowDTO> rows) {
        BigDecimal[] fee = new BigDecimal[FEE_GET.size()];
        Arrays.fill(fee, BigDecimal.ZERO);
        BigDecimal balPrev = BigDecimal.ZERO, recv = BigDecimal.ZERO,
                   coll = BigDecimal.ZERO, end = BigDecimal.ZERO;
        for (LedgerRowDTO r : rows) {
            BigDecimal[] vals = rowFees(r);
            for (int i = 0; i < fee.length; i++) fee[i] = fee[i].add(vals[i]);
            balPrev = balPrev.add(r.balancePrev());
            recv = recv.add(r.totalReceivable());
            coll = coll.add(r.totalCollected());
            end = end.add(r.balanceEnd());
        }
        return new LedgerFooter(
            r2(fee[0]), r2(fee[1]), r2(fee[2]), r2(fee[3]), r2(fee[4]), r2(fee[5]),
            r2(fee[6]), r2(fee[7]), r2(fee[8]), r2(fee[9]), r2(fee[10]), r2(fee[11]),
            r2(fee[12]), r2(fee[13]), r2(fee[14]), r2(fee[15]), r2(fee[16]), r2(fee[17]),
            r2(fee[18]), r2(fee[19]), r2(fee[20]),
            r2(balPrev), r2(recv), r2(coll), r2(end));
    }

    private static BigDecimal[] rowFees(LedgerRowDTO r) {
        return new BigDecimal[]{
            r.factoryRent(), r.factoryMgmtFee(), r.shopRent(), r.dormRent(),
            r.dormFacilitiesFee(), r.shopMgmtFee(), r.factoryInfraMaint(), r.shopInfraMaint(),
            r.dormInfraMaint(), r.elevatorMaint(), r.transformerMaint(), r.landUseTax(),
            r.networkFee(), r.accessCtrlMaint(), r.officeOtherFee(), r.dormOtherFee(),
            r.basicElectricity(), r.standardElectricity(), r.electricityMaint(),
            r.standardWater(), r.waterMaint() };
    }
}
