package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.PvOverviewDTO;
import com.park.demo3.dto.PvOverviewDTO.YearMeta;
import com.park.demo3.dto.PvPhaseDTO;
import com.park.demo3.dto.PvRecordDTO;
import com.park.demo3.dto.PvRecordReq;
import com.park.demo3.dto.PvYearDTO;
import com.park.demo3.dto.PvYearDTO.PvTotal;
import com.park.demo3.entity.PvPhase;
import com.park.demo3.entity.PvRecord;
import com.park.demo3.mapper.PvPhaseMapper;
import com.park.demo3.mapper.PvRecordMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class PvService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final PvPhaseMapper phases;
    private final PvRecordMapper records;

    public PvService(PvPhaseMapper phases, PvRecordMapper records) {
        this.phases = phases; this.records = records;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }

    // 共享派生:gen = selfKwh + gridKwh,fee = selfAmt + gridAmt(绝不落库)
    private static BigDecimal gen(PvRecord r) { return r2(nz(r.getSelfKwh()).add(nz(r.getGridKwh()))); }
    private static BigDecimal fee(PvRecord r) { return r2(nz(r.getSelfAmt()).add(nz(r.getGridAmt()))); }

    // ── phases(按 sortNo) ──
    public List<PvPhaseDTO> phases() {
        return phases.selectAllSorted().stream().map(PvService::toPhaseDTO).toList();
    }

    // ── overview:年份范围 = [2024 .. maxDataYear+1];currentYear = maxDataYear ──
    public PvOverviewDTO overview() {
        Map<Integer, List<PvRecord>> byYear = records.selectList(null).stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1

        List<YearMeta> years = new ArrayList<>();
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));
        for (int y = lo; y <= upper; y++) {
            List<PvRecord> rows = byYear.get(y);
            if (rows == null || rows.isEmpty()) {
                years.add(new YearMeta(y, false, BigDecimal.ZERO.setScale(2), 0));
                continue;
            }
            BigDecimal totalFee = rows.stream().map(PvService::fee).reduce(BigDecimal.ZERO, BigDecimal::add);
            years.add(new YearMeta(y, true, r2(totalFee), rows.size()));
        }
        return new PvOverviewDTO(currentYear, years);
    }

    // ── records(year):该年全部记录升序 + 派生 + phaseName join + 全年合计 + phases ──
    public PvYearDTO records(int year) {
        Map<String, String> phaseName = phases.selectAllSorted().stream()
            .collect(Collectors.toMap(PvPhase::getId, PvPhase::getName));

        List<PvRecord> rows = records.selectByYear(year);
        List<PvRecordDTO> dtos = rows.stream()
            .map(r -> toRecordDTO(r, phaseName.get(r.getPhaseId()))).toList();

        return new PvYearDTO(year, phases(), dtos, total(rows));
    }

    // ── create(source=manual;phase 不存在 → 409) ──
    public PvRecordDTO create(PvRecordReq req) {
        PvPhase phase = phases.selectById(req.phase());
        if (phase == null) throw new BizException(ResultCode.CONFLICT, "期别不存在");

        PvRecord r = new PvRecord();
        r.setPhaseId(req.phase());
        r.setAcctMonth(req.acctMonth());
        r.setOccurMonth(req.occurMonth());
        r.setSelfKwh(r2(req.selfKwh()));
        r.setSelfAmt(r2(req.selfAmt()));
        r.setGridKwh(r2(req.gridKwh()));
        r.setGridAmt(r2(req.gridAmt()));
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note());
        r.setSource("manual");
        records.insert(r);
        return toRecordDTO(records.selectById(r.getId()), phase.getName());
    }

    // ── updateNote(id,note;不存在 → 404) ──
    public PvRecordDTO updateNote(Integer id, String note) {
        PvRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        PvPhase phase = phases.selectById(r.getPhaseId());
        return toRecordDTO(records.selectById(id), phase == null ? null : phase.getName());
    }

    // ── delete(id;source=='seed' → 409;不存在 → 404) ──
    public void delete(Integer id) {
        PvRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if ("seed".equals(r.getSource())) throw new BizException(ResultCode.CONFLICT, "官方台账,不可删除");
        records.deleteById(id);
    }

    // ── helpers ──
    private static PvTotal total(List<PvRecord> rows) {
        BigDecimal g = BigDecimal.ZERO, f = BigDecimal.ZERO,
                   sk = BigDecimal.ZERO, sa = BigDecimal.ZERO,
                   gk = BigDecimal.ZERO, ga = BigDecimal.ZERO;
        for (PvRecord r : rows) {
            g = g.add(gen(r)); f = f.add(fee(r));
            sk = sk.add(nz(r.getSelfKwh())); sa = sa.add(nz(r.getSelfAmt()));
            gk = gk.add(nz(r.getGridKwh())); ga = ga.add(nz(r.getGridAmt()));
        }
        return new PvTotal(r2(g), r2(f), r2(sk), r2(sa), r2(gk), r2(ga));
    }

    private static PvPhaseDTO toPhaseDTO(PvPhase p) {
        return new PvPhaseDTO(p.getId(), p.getName(), p.getShortName(), p.getOnline());
    }

    private static PvRecordDTO toRecordDTO(PvRecord r, String phaseName) {
        return new PvRecordDTO(
            r.getId(), r.getPhaseId(), phaseName,
            r.getAcctMonth(), r.getOccurMonth(),
            r2(r.getSelfKwh()), r2(r.getSelfAmt()),
            r2(r.getGridKwh()), r2(r.getGridAmt()),
            gen(r), fee(r), r.getNote(), r.getSource());
    }
}
