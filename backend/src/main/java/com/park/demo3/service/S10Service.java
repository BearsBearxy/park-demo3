package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.S10ImportRequest;
import com.park.demo3.dto.S10MonthDTO;
import com.park.demo3.dto.S10OverviewDTO;
import com.park.demo3.dto.S10RecordDTO;
import com.park.demo3.dto.S10RecordReq;
import com.park.demo3.dto.S10YearDTO;
import com.park.demo3.entity.S10Record;
import com.park.demo3.mapper.S10RecordMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class S10Service {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final S10RecordMapper records;

    public S10Service(S10RecordMapper records) { this.records = records; }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }
    private static int monthOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(5, 7)); }

    // ── 25 费用列定义(顺序即列展示顺序;getter/setter 一处定义,派生/落库/DTO 复用) ──
    private record Col(String name, Function<S10Record, BigDecimal> get, BiConsumer<S10Record, BigDecimal> set,
                       Function<S10RecordReq, BigDecimal> req, Function<S10ImportRequest.Row, BigDecimal> imp) {}
    private static final List<Col> COLS = List.of(
        new Col("officeRent",       S10Record::getOfficeRent,       S10Record::setOfficeRent,       S10RecordReq::officeRent,       S10ImportRequest.Row::officeRent),
        new Col("officeMgmtFee",    S10Record::getOfficeMgmtFee,    S10Record::setOfficeMgmtFee,    S10RecordReq::officeMgmtFee,    S10ImportRequest.Row::officeMgmtFee),
        new Col("factoryRent",      S10Record::getFactoryRent,      S10Record::setFactoryRent,      S10RecordReq::factoryRent,      S10ImportRequest.Row::factoryRent),
        new Col("factoryMgmtFee",   S10Record::getFactoryMgmtFee,   S10Record::setFactoryMgmtFee,   S10RecordReq::factoryMgmtFee,   S10ImportRequest.Row::factoryMgmtFee),
        new Col("landRent",         S10Record::getLandRent,         S10Record::setLandRent,         S10RecordReq::landRent,         S10ImportRequest.Row::landRent),
        new Col("shopRent",         S10Record::getShopRent,         S10Record::setShopRent,         S10RecordReq::shopRent,         S10ImportRequest.Row::shopRent),
        new Col("shopMgmtFee",      S10Record::getShopMgmtFee,      S10Record::setShopMgmtFee,      S10RecordReq::shopMgmtFee,      S10ImportRequest.Row::shopMgmtFee),
        new Col("dormRent",         S10Record::getDormRent,         S10Record::setDormRent,         S10RecordReq::dormRent,         S10ImportRequest.Row::dormRent),
        new Col("dormFacilityFee",  S10Record::getDormFacilityFee,  S10Record::setDormFacilityFee,  S10RecordReq::dormFacilityFee,  S10ImportRequest.Row::dormFacilityFee),
        new Col("infraOffice",      S10Record::getInfraOffice,      S10Record::setInfraOffice,      S10RecordReq::infraOffice,      S10ImportRequest.Row::infraOffice),
        new Col("infraFactory",     S10Record::getInfraFactory,     S10Record::setInfraFactory,     S10RecordReq::infraFactory,     S10ImportRequest.Row::infraFactory),
        new Col("infraShop",        S10Record::getInfraShop,        S10Record::setInfraShop,        S10RecordReq::infraShop,        S10ImportRequest.Row::infraShop),
        new Col("infraDorm",        S10Record::getInfraDorm,        S10Record::setInfraDorm,        S10RecordReq::infraDorm,        S10ImportRequest.Row::infraDorm),
        new Col("elevatorMaint",    S10Record::getElevatorMaint,    S10Record::setElevatorMaint,    S10RecordReq::elevatorMaint,    S10ImportRequest.Row::elevatorMaint),
        new Col("transformerMaint", S10Record::getTransformerMaint, S10Record::setTransformerMaint, S10RecordReq::transformerMaint, S10ImportRequest.Row::transformerMaint),
        new Col("landUseTax",       S10Record::getLandUseTax,       S10Record::setLandUseTax,       S10RecordReq::landUseTax,       S10ImportRequest.Row::landUseTax),
        new Col("networkFee",       S10Record::getNetworkFee,       S10Record::setNetworkFee,       S10RecordReq::networkFee,       S10ImportRequest.Row::networkFee),
        new Col("accessMaint",      S10Record::getAccessMaint,      S10Record::setAccessMaint,      S10RecordReq::accessMaint,      S10ImportRequest.Row::accessMaint),
        new Col("otherFee",         S10Record::getOtherFee,         S10Record::setOtherFee,         S10RecordReq::otherFee,         S10ImportRequest.Row::otherFee),
        new Col("elecBasic",        S10Record::getElecBasic,        S10Record::setElecBasic,        S10RecordReq::elecBasic,        S10ImportRequest.Row::elecBasic),
        new Col("elecStd",          S10Record::getElecStd,          S10Record::setElecStd,          S10RecordReq::elecStd,          S10ImportRequest.Row::elecStd),
        new Col("elecMaint",        S10Record::getElecMaint,        S10Record::setElecMaint,        S10RecordReq::elecMaint,        S10ImportRequest.Row::elecMaint),
        new Col("waterStd",         S10Record::getWaterStd,         S10Record::setWaterStd,         S10RecordReq::waterStd,         S10ImportRequest.Row::waterStd),
        new Col("waterMaint",       S10Record::getWaterMaint,       S10Record::setWaterMaint,       S10RecordReq::waterMaint,       S10ImportRequest.Row::waterMaint),
        new Col("guaranteeRent",    S10Record::getGuaranteeRent,    S10Record::setGuaranteeRent,    S10RecordReq::guaranteeRent,    S10ImportRequest.Row::guaranteeRent));

    // 行合计 = 该行 25 列之和(派生,不落库)
    private static BigDecimal rowTotal(S10Record r) {
        BigDecimal t = BigDecimal.ZERO;
        for (Col c : COLS) t = t.add(nz(c.get().apply(r)));
        return r2(t);
    }

    // ── overview:年份范围 [min(BASE_YEAR,minData) .. maxData+1];currentYear=maxData;currentMonth=该年最大数据月 ──
    public S10OverviewDTO overview() {
        List<S10Record> all = records.selectList(null);
        Map<Integer, List<S10Record>> byYear = all.stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));

        // currentMonth = currentYear 的最大数据月(无数据 → 0)
        int currentMonth = byYear.getOrDefault(currentYear, List.of()).stream()
            .mapToInt(r -> monthOf(r.getAcctMonth())).max().orElse(0);

        List<Integer> yearList = new ArrayList<>();
        List<S10YearDTO> summaries = new ArrayList<>();
        for (int y = lo; y <= upper; y++) {
            yearList.add(y);
            List<S10Record> rows = byYear.getOrDefault(y, List.of());
            int recordedMonths = (int) rows.stream().map(r -> monthOf(r.getAcctMonth())).distinct().count();
            int tenantCount = (int) rows.stream().map(S10Service::tenantKey).distinct().count();
            summaries.add(new S10YearDTO(y, recordedMonths, tenantCount));
        }
        int[] years = yearList.stream().mapToInt(Integer::intValue).toArray();
        return new S10OverviewDTO(years, currentYear, currentMonth, summaries);
    }

    // 去重租户键:优先 tenant_id,缺失软引用时退回 tenant_name
    private static String tenantKey(S10Record r) {
        return r.getTenantId() != null ? "id:" + r.getTenantId() : "name:" + r.getTenantName();
    }

    // ── month(phase,year,month):稀疏读 —— 无行回空(不补零);列合计/总计后端算;每行 total 派生 ──
    public S10MonthDTO month(int phase, int year, int month) {
        String acctMonth = String.format("%04d-%02d", year, month);
        List<S10Record> rows = records.selectBySlot(phase, acctMonth);
        List<S10RecordDTO> dtos = rows.stream().map(S10Service::toRecordDTO).toList();

        Map<String, BigDecimal> columnTotals = new LinkedHashMap<>();
        BigDecimal grandTotal = BigDecimal.ZERO;
        for (Col c : COLS) {
            BigDecimal sum = BigDecimal.ZERO;
            for (S10Record r : rows) sum = sum.add(nz(c.get().apply(r)));
            columnTotals.put(c.name(), r2(sum));
            grandTotal = grandTotal.add(sum);
        }
        return new S10MonthDTO(phase, year, month, !rows.isEmpty(), dtos, columnTotals, r2(grandTotal));
    }

    // ── save:按 (phase,acctMonth,tenantName) upsert(source=manual,既有行保留其 source) ──
    public S10RecordDTO save(S10RecordReq req) {
        S10Record r = records.selectBySlotTenant(req.phase(), req.acctMonth(), req.tenantName());
        boolean isNew = r == null;
        if (isNew) {
            r = new S10Record();
            r.setPhase(req.phase());
            r.setAcctMonth(req.acctMonth());
            r.setTenantName(req.tenantName());
            r.setSource("manual");
        }
        r.setTenantId(req.tenantId());
        r.setProfile(req.profile());
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note());
        for (Col c : COLS) c.set().accept(r, r2(c.req().apply(req)));
        if (isNew) records.insert(r); else records.updateById(r);
        return toRecordDTO(records.selectById(r.getId()));
    }

    // ── import:逐行按 (phase,acctMonth,tenantName) upsert;新行 source='import'、tenant_id=null(软引用) ──
    @org.springframework.transaction.annotation.Transactional
    public ImportResultDTO importRows(S10ImportRequest req) {
        int imported = 0;
        List<ImportError> errors = new ArrayList<>();
        List<S10ImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            S10ImportRequest.Row row = rows.get(i);
            String name = row.tenantName() == null ? null : row.tenantName().trim();
            if (name == null || name.isEmpty()) {
                errors.add(new ImportError(i, row.tenantName(), "租户名称为空"));
                continue;
            }
            S10Record r = records.selectBySlotTenant(req.phase(), req.acctMonth(), name);
            boolean isNew = r == null;
            if (isNew) {
                r = new S10Record();
                r.setPhase(req.phase());
                r.setAcctMonth(req.acctMonth());
                r.setTenantName(name);
                r.setTenantId(null);          // 软引用:导入不解析 FK
                r.setSource("import");
            }
            r.setProfile(row.profile());
            for (Col c : COLS) c.set().accept(r, r2(c.imp().apply(row)));
            if (isNew) records.insert(r); else records.updateById(r);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── updateNote(id,note;不存在 → 404) ──
    public S10RecordDTO updateNote(Long id, String note) {
        S10Record r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        return toRecordDTO(records.selectById(id));
    }

    // ── delete(id;不存在 → 404;source=='seed' → 409) ──
    public void delete(Long id) {
        S10Record r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if ("seed".equals(r.getSource())) throw new BizException(ResultCode.CONFLICT, "官方台账,不可删除");
        records.deleteById(id);
    }

    // ── helper:entity → DTO(25 列 r2 + 派生 total) ──
    private static S10RecordDTO toRecordDTO(S10Record r) {
        return new S10RecordDTO(
            r.getId(), r.getTenantId(), r.getTenantName(), r.getPhase(), r.getProfile(), r.getNote(), r.getSource(),
            r2(r.getOfficeRent()), r2(r.getOfficeMgmtFee()), r2(r.getFactoryRent()), r2(r.getFactoryMgmtFee()),
            r2(r.getLandRent()), r2(r.getShopRent()), r2(r.getShopMgmtFee()), r2(r.getDormRent()),
            r2(r.getDormFacilityFee()), r2(r.getInfraOffice()), r2(r.getInfraFactory()), r2(r.getInfraShop()),
            r2(r.getInfraDorm()), r2(r.getElevatorMaint()), r2(r.getTransformerMaint()), r2(r.getLandUseTax()),
            r2(r.getNetworkFee()), r2(r.getAccessMaint()), r2(r.getOtherFee()), r2(r.getElecBasic()),
            r2(r.getElecStd()), r2(r.getElecMaint()), r2(r.getWaterStd()), r2(r.getWaterMaint()),
            r2(r.getGuaranteeRent()), rowTotal(r));
    }
}
