package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.DeleteResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.SalaryImportRequest;
import com.park.demo3.dto.SalaryOverviewDTO;
import com.park.demo3.dto.SalaryOverviewDTO.YearMeta;
import com.park.demo3.dto.SalaryRecordDTO;
import com.park.demo3.dto.SalaryRecordReq;
import com.park.demo3.dto.SalaryYearMonthDTO;
import com.park.demo3.dto.SalaryYearMonthDTO.Total;
import com.park.demo3.entity.SalaryRecord;
import com.park.demo3.mapper.SalaryRecordMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Collectors;

@Service
public class SalaryService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final SalaryRecordMapper records;

    public SalaryService(SalaryRecordMapper records) { this.records = records; }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }
    private static int monthOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(5, 7)); }

    // 共享派生(绝不落库)
    private static BigDecimal wageTotal(SalaryRecord r) {
        return r2(nz(r.getBase()).add(nz(r.getPost())).add(nz(r.getPerf())).add(nz(r.getAttend()))
            .add(nz(r.getSkill())).add(nz(r.getEdu())).add(nz(r.getOther())));
    }
    private static BigDecimal gross(SalaryRecord r) {
        return r2(wageTotal(r).add(nz(r.getLunch())).add(nz(r.getHeat())).add(nz(r.getCommission())));
    }
    private static BigDecimal deduct(SalaryRecord r) {
        return r2(nz(r.getSocial()).add(nz(r.getTax())).add(nz(r.getOtherDeduct())));
    }
    private static BigDecimal net(SalaryRecord r) { return r2(gross(r).subtract(deduct(r))); }

    // ── overview:年份范围 = [2024 .. maxDataYear+1];currentYear = maxDataYear;每年人次/实发/有数据月份 ──
    public SalaryOverviewDTO overview() {
        Map<Integer, List<SalaryRecord>> byYear = records.selectList(null).stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1

        List<YearMeta> years = new ArrayList<>();
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));
        for (int y = lo; y <= upper; y++) {
            List<SalaryRecord> rows = byYear.get(y);
            if (rows == null || rows.isEmpty()) {
                years.add(new YearMeta(y, false, 0, BigDecimal.ZERO.setScale(2), List.of()));
                continue;
            }
            BigDecimal netTotal = rows.stream().map(SalaryService::net).reduce(BigDecimal.ZERO, BigDecimal::add);
            List<Integer> months = rows.stream().map(r -> monthOf(r.getAcctMonth()))
                .collect(Collectors.toCollection(TreeSet::new)).stream().toList();
            years.add(new YearMeta(y, true, rows.size(), r2(netTotal), months));
        }
        return new SalaryOverviewDTO(currentYear, years);
    }

    // ── records(year,month):该月全部记录(emp_idx,name 升序)+ 派生 + 合计 ──
    public SalaryYearMonthDTO records(int year, int month) {
        String acctMonth = year + "-" + (month < 10 ? "0" + month : String.valueOf(month));
        List<SalaryRecord> rows = records.selectByMonth(acctMonth);
        List<SalaryRecordDTO> dtos = rows.stream().map(SalaryService::toDTO).toList();
        return new SalaryYearMonthDTO(year, month, dtos, total(rows));
    }

    // ── create(source=manual) ──
    public SalaryRecordDTO create(SalaryRecordReq req) {
        SalaryRecord r = new SalaryRecord();
        r.setAcctMonth(req.acctMonth());
        r.setEmpIdx(0);
        r.setName(req.name().trim());
        r.setRole(blankToNull(req.role()));
        r.setBase(r2(req.base()));
        r.setPost(r2(req.post()));
        r.setPerf(r2(req.perf()));
        r.setAttend(r2(req.attend()));
        r.setSkill(r2(req.skill()));
        r.setEdu(r2(req.edu()));
        r.setOther(r2(req.other()));
        r.setLunch(r2(req.lunch()));
        r.setHeat(r2(req.heat()));
        r.setCommission(r2(req.commission()));
        r.setShouldDays(req.shouldDays() == null ? 0 : req.shouldDays());
        r.setLeaveDays(req.leaveDays() == null ? 0 : req.leaveDays());
        r.setSocial(r2(req.social()));
        r.setTax(r2(req.tax()));
        r.setOtherDeduct(r2(req.otherDeduct()));
        r.setSign(false);
        r.setNote(blankToNull(req.note()));
        r.setSource("manual");
        records.insert(r);
        return toDTO(records.selectById(r.getId()));
    }

    // ── import:重导=替换本月导入行 —— 先删该 acctMonth 的 source='import' 行,再逐行 insert(source='import')。
    //          手动(emp_idx=0)/种子行不动;name 空 → errors 跳过;empIdx=导入行序(1递增);sign=false。 ──
    @org.springframework.transaction.annotation.Transactional
    public ImportResultDTO importRows(int year, int month, SalaryImportRequest req) {
        String acctMonth = String.format("%04d-%02d", year, month);
        records.deleteImported(acctMonth);
        int imported = 0;
        List<ImportError> errors = new ArrayList<>();
        List<SalaryImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            SalaryImportRequest.Row row = rows.get(i);
            String name = row.tenantName() == null ? null : row.tenantName().trim();
            if (name == null || name.isEmpty()) {
                errors.add(new ImportError(i, row.tenantName(), "姓名为空"));
                continue;
            }
            SalaryRecord r = new SalaryRecord();
            r.setAcctMonth(acctMonth);
            r.setEmpIdx(imported + 1);     // 导入行序(1,2,…)
            r.setName(name);
            r.setRole(blankToNull(row.role()));
            r.setBase(r2(row.base()));
            r.setPost(r2(row.post()));
            r.setPerf(r2(row.perf()));
            r.setAttend(r2(row.attend()));
            r.setSkill(r2(row.skill()));
            r.setEdu(r2(row.edu()));
            r.setOther(r2(row.other()));
            r.setLunch(r2(row.lunch()));
            r.setHeat(r2(row.heat()));
            r.setCommission(r2(row.commission()));
            // ponytail: 考勤天数实体为 int,真实文件含小数(请假 2.125/0.5)→ 四舍五入取整。
            //           上限:如需精确小数,后续改 BigDecimal(实体+迁移+DTO+合计+导出,独立一刀)。
            r.setShouldDays(roundDays(row.shouldDays()));
            r.setLeaveDays(roundDays(row.leaveDays()));
            r.setSocial(r2(row.social()));
            r.setTax(r2(row.tax()));
            r.setOtherDeduct(r2(row.otherDeduct()));
            r.setSign(false);
            r.setSource("import");
            records.insert(r);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── clearImported(year,month):删本月 source='import' 行,返回删除计数 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO clearImported(int year, int month) {
        int deleted = records.deleteImported(String.format("%04d-%02d", year, month));
        return new DeleteResultDTO(deleted, 0);
    }

    // ── batchDelete(ids):按 id 删(seed/manual/import 同等可删);不存在的 id 静默忽略,skipped 恒 0 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO batchDelete(List<Long> ids) {
        int deleted = 0;
        for (Long id : ids) {
            SalaryRecord r = records.selectById(id);
            if (r == null) continue;
            records.deleteById(id);
            deleted++;
        }
        return new DeleteResultDTO(deleted, 0);
    }

    // ── updateNote(id,note;不存在 → 404) ──
    public SalaryRecordDTO updateNote(Integer id, String note) {
        SalaryRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(blankToNull(note));
        records.updateById(r);
        return toDTO(records.selectById(id));
    }

    // ── delete(id;不存在 → 404;seed 同等可删) ──
    public void delete(Integer id) {
        SalaryRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        records.deleteById(id);
    }

    // ── helpers ──
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }
    // 考勤天数 BigDecimal → int(四舍五入,空→0)
    private static int roundDays(BigDecimal v) { return v == null ? 0 : v.setScale(0, RoundingMode.HALF_UP).intValueExact(); }

    private static Total total(List<SalaryRecord> rows) {
        BigDecimal base = BigDecimal.ZERO, post = BigDecimal.ZERO, perf = BigDecimal.ZERO, attend = BigDecimal.ZERO,
                   skill = BigDecimal.ZERO, edu = BigDecimal.ZERO, other = BigDecimal.ZERO,
                   lunch = BigDecimal.ZERO, heat = BigDecimal.ZERO, commission = BigDecimal.ZERO,
                   wage = BigDecimal.ZERO, grossT = BigDecimal.ZERO,
                   social = BigDecimal.ZERO, tax = BigDecimal.ZERO, otherDeduct = BigDecimal.ZERO,
                   deductT = BigDecimal.ZERO, netT = BigDecimal.ZERO;
        for (SalaryRecord r : rows) {
            base = base.add(nz(r.getBase())); post = post.add(nz(r.getPost()));
            perf = perf.add(nz(r.getPerf())); attend = attend.add(nz(r.getAttend()));
            skill = skill.add(nz(r.getSkill())); edu = edu.add(nz(r.getEdu())); other = other.add(nz(r.getOther()));
            lunch = lunch.add(nz(r.getLunch())); heat = heat.add(nz(r.getHeat())); commission = commission.add(nz(r.getCommission()));
            wage = wage.add(wageTotal(r)); grossT = grossT.add(gross(r));
            social = social.add(nz(r.getSocial())); tax = tax.add(nz(r.getTax())); otherDeduct = otherDeduct.add(nz(r.getOtherDeduct()));
            deductT = deductT.add(deduct(r)); netT = netT.add(net(r));
        }
        return new Total(r2(base), r2(post), r2(perf), r2(attend), r2(skill), r2(edu), r2(other),
            r2(lunch), r2(heat), r2(commission), r2(wage), r2(grossT),
            r2(social), r2(tax), r2(otherDeduct), r2(deductT), r2(netT));
    }

    private static SalaryRecordDTO toDTO(SalaryRecord r) {
        int shouldDays = r.getShouldDays() == null ? 0 : r.getShouldDays();
        int leaveDays = r.getLeaveDays() == null ? 0 : r.getLeaveDays();
        return new SalaryRecordDTO(
            r.getId(), r.getAcctMonth(), r.getEmpIdx(), r.getName(), r.getRole(),
            r2(r.getBase()), r2(r.getPost()), r2(r.getPerf()), r2(r.getAttend()),
            r2(r.getSkill()), r2(r.getEdu()), r2(r.getOther()),
            r2(r.getLunch()), r2(r.getHeat()), r2(r.getCommission()),
            shouldDays, leaveDays,
            r2(r.getSocial()), r2(r.getTax()), r2(r.getOtherDeduct()),
            Boolean.TRUE.equals(r.getSign()),
            wageTotal(r), gross(r), deduct(r), net(r),
            shouldDays - leaveDays, leaveDays == 0,
            r.getNote(), r.getSource());
    }
}
