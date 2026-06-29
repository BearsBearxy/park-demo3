package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ElecOverviewDTO;
import com.park.demo3.dto.ElecOverviewDTO.YearMeta;
import com.park.demo3.dto.ElecPhaseDTO;
import com.park.demo3.dto.ElecRecordDTO;
import com.park.demo3.dto.ElecRecordReq;
import com.park.demo3.dto.ElecYearDTO;
import com.park.demo3.dto.ElecYearDTO.ElecTotal;
import com.park.demo3.entity.ElecPhase;
import com.park.demo3.entity.ElecRecord;
import com.park.demo3.mapper.ElecPhaseMapper;
import com.park.demo3.mapper.ElecRecordMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class ElecService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final ElecPhaseMapper phases;
    private final ElecRecordMapper records;

    public ElecService(ElecPhaseMapper phases, ElecRecordMapper records) {
        this.phases = phases; this.records = records;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }

    // 共享派生(绝不落库):amount = energy:qty×price / basic:demand×price;tax = amount×rate;total = amount+tax
    private static BigDecimal amount(ElecRecord r) {
        BigDecimal base = "basic".equals(r.getType()) ? nz(r.getDemand()) : nz(r.getQty());
        return r2(base.multiply(nz(r.getPrice())));
    }
    private static BigDecimal tax(ElecRecord r) { return r2(amount(r).multiply(nz(r.getRate()))); }
    private static BigDecimal total(ElecRecord r) { return r2(amount(r).add(tax(r))); }

    // ── phases(按 sortNo) ──
    public List<ElecPhaseDTO> phases() {
        return phases.selectAllSorted().stream().map(ElecService::toPhaseDTO).toList();
    }

    // ── overview:年份范围 = [2024 .. maxDataYear+1];currentYear = maxDataYear;价税合计跨 energy+basic ──
    public ElecOverviewDTO overview() {
        Map<Integer, List<ElecRecord>> byYear = records.selectList(null).stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1

        List<YearMeta> years = new ArrayList<>();
        for (int y = BASE_YEAR; y <= upper; y++) {
            List<ElecRecord> rows = byYear.get(y);
            if (rows == null || rows.isEmpty()) {
                years.add(new YearMeta(y, false, BigDecimal.ZERO.setScale(2), 0));
                continue;
            }
            BigDecimal totalFee = rows.stream().map(ElecService::total).reduce(BigDecimal.ZERO, BigDecimal::add);
            years.add(new YearMeta(y, true, r2(totalFee), rows.size()));
        }
        return new ElecOverviewDTO(currentYear, years);
    }

    // ── records(year,type):该年该 type 全部记录升序 + 派生 + phaseName join + 合计 + phases ──
    public ElecYearDTO records(int year, String type) {
        Map<String, String> phaseName = phases.selectAllSorted().stream()
            .collect(Collectors.toMap(ElecPhase::getId, ElecPhase::getName));

        List<ElecRecord> rows = records.selectByYearAndType(year, type);
        List<ElecRecordDTO> dtos = rows.stream()
            .map(r -> toRecordDTO(r, phaseName.get(r.getPhaseId()))).toList();

        return new ElecYearDTO(year, type, phases(), dtos, total(rows));
    }

    // ── create(source=manual;phase 不存在 → 409) ──
    public ElecRecordDTO create(ElecRecordReq req) {
        ElecPhase phase = phases.selectById(req.phase());
        if (phase == null) throw new BizException(ResultCode.CONFLICT, "期别不存在");

        ElecRecord r = new ElecRecord();
        r.setType(req.type());
        r.setPhaseId(req.phase());
        r.setAcctMonth(req.acctMonth());
        r.setInvDate(req.invDate() == null || req.invDate().isBlank() ? null : req.invDate());
        boolean energy = !"basic".equals(req.type());
        r.setPeriod(energy ? req.period() : null);
        r.setCat(energy ? req.cat() : null);
        r.setUnit(energy ? req.unit() : null);
        r.setQty(energy ? r2(req.qty()) : null);
        r.setDemand(energy ? null : r2(req.demand()));
        r.setPrice(nz(req.price()).setScale(6, RoundingMode.HALF_UP));
        r.setRate(nz(req.rate()).setScale(4, RoundingMode.HALF_UP));
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note());
        r.setSource("manual");
        records.insert(r);
        return toRecordDTO(records.selectById(r.getId()), phase.getName());
    }

    // ── updateNote(id,note;不存在 → 404) ──
    public ElecRecordDTO updateNote(Integer id, String note) {
        ElecRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        ElecPhase phase = phases.selectById(r.getPhaseId());
        return toRecordDTO(records.selectById(id), phase == null ? null : phase.getName());
    }

    // ── delete(id;source=='seed' → 409;不存在 → 404) ──
    public void delete(Integer id) {
        ElecRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if ("seed".equals(r.getSource())) throw new BizException(ResultCode.CONFLICT, "官方台账,不可删除");
        records.deleteById(id);
    }

    // ── helpers ──
    private static ElecTotal total(List<ElecRecord> rows) {
        BigDecimal q = BigDecimal.ZERO, d = BigDecimal.ZERO,
                   a = BigDecimal.ZERO, t = BigDecimal.ZERO, tt = BigDecimal.ZERO;
        for (ElecRecord r : rows) {
            q = q.add(nz(r.getQty())); d = d.add(nz(r.getDemand()));
            a = a.add(amount(r)); t = t.add(tax(r)); tt = tt.add(total(r));
        }
        return new ElecTotal(r2(q), r2(d), r2(a), r2(t), r2(tt));
    }

    private static ElecPhaseDTO toPhaseDTO(ElecPhase p) {
        return new ElecPhaseDTO(p.getId(), p.getName(), p.getShortName());
    }

    private static ElecRecordDTO toRecordDTO(ElecRecord r, String phaseName) {
        return new ElecRecordDTO(
            r.getId(), r.getType(), r.getPhaseId(), phaseName,
            r.getAcctMonth(), r.getInvDate(), r.getPeriod(), r.getCat(), r.getUnit(),
            r.getQty() == null ? null : r2(r.getQty()),
            r.getDemand() == null ? null : r2(r.getDemand()),
            r.getPrice(), r.getRate(),
            amount(r), tax(r), total(r), r.getNote(), r.getSource());
    }
}
