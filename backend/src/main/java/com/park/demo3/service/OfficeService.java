package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.OfficeOverviewDTO;
import com.park.demo3.dto.OfficeOverviewDTO.YearMeta;
import com.park.demo3.dto.OfficeRecordDTO;
import com.park.demo3.dto.OfficeRecordReq;
import com.park.demo3.dto.OfficeYearDTO;
import com.park.demo3.dto.OfficeYearDTO.OfficeTotal;
import com.park.demo3.entity.OfficeRecord;
import com.park.demo3.mapper.OfficeRecordMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class OfficeService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final OfficeRecordMapper records;

    public OfficeService(OfficeRecordMapper records) { this.records = records; }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }

    // 共享派生(绝不落库):电费金额=elecQty×elecPrice; 水费金额=waterQty×waterPrice; 合计=两者和
    private static BigDecimal elecAmt(OfficeRecord r) { return r2(nz(r.getElecQty()).multiply(nz(r.getElecPrice()))); }
    private static BigDecimal waterAmt(OfficeRecord r) { return r2(nz(r.getWaterQty()).multiply(nz(r.getWaterPrice()))); }
    private static BigDecimal total(OfficeRecord r) { return r2(elecAmt(r).add(waterAmt(r))); }

    // ── overview:合并 13+14 两子表 → 年份范围 = [min(2024,minData) .. maxData+1];currentYear=maxData ──
    public OfficeOverviewDTO overview() {
        List<OfficeRecord> all = Stream.concat(
            records.selectBySchedule(13).stream(),
            records.selectBySchedule(14).stream()).toList();
        Map<Integer, List<OfficeRecord>> byYear = all.stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1

        List<YearMeta> years = new ArrayList<>();
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));
        for (int y = lo; y <= upper; y++) {
            List<OfficeRecord> rows = byYear.get(y);
            if (rows == null || rows.isEmpty()) {
                years.add(new YearMeta(y, false, BigDecimal.ZERO.setScale(2), 0));
                continue;
            }
            BigDecimal totalFee = rows.stream().map(OfficeService::total).reduce(BigDecimal.ZERO, BigDecimal::add);
            years.add(new YearMeta(y, true, r2(totalFee), rows.size()));
        }
        return new OfficeOverviewDTO(currentYear, years);
    }

    // ── records(no,year):该附表该年记录 acct_month,id 升序 + 派生 + 合计 ──
    public OfficeYearDTO records(int no, int year) {
        List<OfficeRecord> rows = records.selectByScheduleAndYear(no, year);
        List<OfficeRecordDTO> dtos = rows.stream().map(OfficeService::toRecordDTO).toList();
        return new OfficeYearDTO(year, no, dtos, total(rows));
    }

    // ── create(source=manual;附表号非法 → 404;路径附表与 body 不一致 → 409) ──
    public OfficeRecordDTO create(int no, OfficeRecordReq req) {
        if (no != 13 && no != 14) throw new BizException(ResultCode.NOT_FOUND, "附表不存在");
        if (req.scheduleNo() == null || req.scheduleNo() != no)
            throw new BizException(ResultCode.CONFLICT, "路径与记账附表不一致");

        OfficeRecord r = new OfficeRecord();
        r.setScheduleNo(req.scheduleNo());
        r.setAcctMonth(req.acctMonth());
        r.setBelongMonth(req.belongMonth());
        r.setElecQty(r2(req.elecQty()));
        r.setElecPrice(nz(req.elecPrice()).setScale(6, RoundingMode.HALF_UP));
        r.setWaterQty(r2(req.waterQty()));
        r.setWaterPrice(nz(req.waterPrice()).setScale(6, RoundingMode.HALF_UP));
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note());
        r.setSource("manual");
        records.insert(r);
        return toRecordDTO(records.selectById(r.getId()));
    }

    // ── updateNote(no,id,note;不存在 / 不属本附表 → 404) ──
    public OfficeRecordDTO updateNote(int no, Integer id, String note) {
        OfficeRecord r = records.selectById(id);
        if (r == null || r.getScheduleNo() != no) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        return toRecordDTO(records.selectById(id));
    }

    // ── delete(no,id;不存在 / 不属本附表 → 404;source=='seed' → 409) ──
    public void delete(int no, Integer id) {
        OfficeRecord r = records.selectById(id);
        if (r == null || r.getScheduleNo() != no) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if ("seed".equals(r.getSource())) throw new BizException(ResultCode.CONFLICT, "官方台账,不可删除");
        records.deleteById(id);
    }

    // ── helpers ──
    private static OfficeTotal total(List<OfficeRecord> rows) {
        BigDecimal eq = BigDecimal.ZERO, ea = BigDecimal.ZERO,
                   wq = BigDecimal.ZERO, wa = BigDecimal.ZERO, tt = BigDecimal.ZERO;
        for (OfficeRecord r : rows) {
            eq = eq.add(nz(r.getElecQty())); ea = ea.add(elecAmt(r));
            wq = wq.add(nz(r.getWaterQty())); wa = wa.add(waterAmt(r));
            tt = tt.add(total(r));
        }
        return new OfficeTotal(r2(eq), r2(ea), r2(wq), r2(wa), r2(tt));
    }

    private static OfficeRecordDTO toRecordDTO(OfficeRecord r) {
        return new OfficeRecordDTO(
            r.getId(), r.getScheduleNo(), r.getAcctMonth(), r.getBelongMonth(),
            r2(r.getElecQty()), r.getElecPrice(), elecAmt(r),
            r2(r.getWaterQty()), r.getWaterPrice(), waterAmt(r),
            total(r), r.getNote(), r.getSource());
    }
}
