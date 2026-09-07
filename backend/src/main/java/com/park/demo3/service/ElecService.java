package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.DeleteResultDTO;
import com.park.demo3.dto.ElecImportRequest;
import com.park.demo3.dto.ElecOverviewDTO;
import com.park.demo3.dto.ElecOverviewDTO.YearMeta;
import com.park.demo3.dto.ElecPhaseDTO;
import com.park.demo3.dto.ElecRecordDTO;
import com.park.demo3.dto.ElecRecordReq;
import com.park.demo3.dto.ElecYearDTO;
import com.park.demo3.dto.ElecYearDTO.ElecTotal;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.entity.ElecPhase;
import com.park.demo3.entity.ElecRecord;
import com.park.demo3.mapper.ElecPhaseMapper;
import com.park.demo3.mapper.ElecRecordMapper;
import com.park.demo3.security.ReviewGuard;
import com.park.demo3.security.ReviewKind;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class ElecService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final ElecPhaseMapper phases;
    private final ElecRecordMapper records;
    private final ReviewGuard reviewGuard;

    public ElecService(ElecPhaseMapper phases, ElecRecordMapper records, ReviewGuard reviewGuard) {
        this.phases = phases; this.records = records; this.reviewGuard = reviewGuard;
    }

    /**
     * 附表11 报送台账的审核闸(§7.4)。园区级表,不带 scope。
     *
     * ⚠ elec-cost 这把键守的是**本类**(表 elec_record),不是 ElecCostService —— spec §7.4 早期版本
     * 点名 ElecCostService 是点反了:本月出账屏清单上「附表11」那一行的 done 判据读的是
     * ElecRecordMapper(DataHomeService)。园区电费模型(elec_cost_entry)是另一把键 elec-model。
     */
    private void assertElecEditable(String acctMonth) {
        reviewGuard.assertEditable(ReviewKind.ELEC_COST, acctMonth, null);
    }

    /** 整年一条 SQL 的写路径专用:该年 12 个月全送进批量闸(点名最早的锁月)。 */
    private void assertYearEditable(int year) {
        List<String> months = new ArrayList<>(12);
        for (int m = 1; m <= 12; m++) months.add(String.format("%04d-%02d", year, m));
        reviewGuard.assertEditable(ReviewKind.ELEC_COST, months, null);
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
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));
        for (int y = lo; y <= upper; y++) {
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
        assertElecEditable(req.acctMonth());

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
        assertElecEditable(r.getAcctMonth());
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        ElecPhase phase = phases.selectById(r.getPhaseId());
        return toRecordDTO(records.selectById(id), phase == null ? null : phase.getName());
    }

    // ── delete(id;seed 同等可删;不存在 → 404) ──
    public void delete(Integer id) {
        ElecRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        assertElecEditable(r.getAcctMonth());
        records.deleteById(id);
    }

    // ── import:每行自带 type(energy/basic)+phaseId(p1/p2/p3)+acctMonth(YYYY-MM,必填)。
    //          按(phaseId,acctMonth)整月整期 upsert:先删被导入(期,月)的任意来源 energy+basic 行,
    //          再逐行 insert(source=import)——「导入即覆盖这些(期,月)」,自动取代假种子,不波及未导入的(期,月)。
    //          校验 type∈{energy,basic}、phaseId∈{p1,p2,p3}、acctMonth 形如 YYYY-MM 且年 2000-2100、月 1-12;非法 → errors 跳过。 ──
    private static final Pattern YM = Pattern.compile("(\\d{4})-(\\d{2})");
    private static final Set<String> PHASES = Set.of("p1", "p2", "p3");
    private static final Set<String> TYPES = Set.of("energy", "basic");

    @org.springframework.transaction.annotation.Transactional
    public ImportResultDTO importRows(ElecImportRequest req) {
        List<ElecImportRequest.Row> rows = req.rows();
        List<ElecImportRequest.Row> valid = new ArrayList<>();
        List<ImportError> errors = new ArrayList<>();
        // 被导入的(期,月):按期收集月份集合,逐期整月删(energy+basic 都删)
        Map<String, Set<String>> monthsByPhase = new java.util.LinkedHashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            ElecImportRequest.Row row = rows.get(i);
            if (!TYPES.contains(row.type())) {
                errors.add(new ImportError(i, String.valueOf(row.type()), "类型非法(应为 energy/basic)"));
                continue;
            }
            if (!PHASES.contains(row.phaseId())) {
                errors.add(new ImportError(i, String.valueOf(row.phaseId()), "期别非法(应为 p1/p2/p3)"));
                continue;
            }
            if (!validMonth(row.acctMonth())) {
                errors.add(new ImportError(i, String.valueOf(row.acctMonth()), "记账月格式非法(应为 YYYY-MM,年 2000-2100、月 1-12)"));
                continue;
            }
            valid.add(row);
            monthsByPhase.computeIfAbsent(row.phaseId(), k -> new LinkedHashSet<>()).add(row.acctMonth());
        }
        // 一批可跨月:用现成的 monthsByPhase(已过 validMonth,口径与 ReviewKey 同严)去重后一次闸掉。
        // 非法月的行本来就进 errors 跳过,压根不在这个集合里 —— 行级容错不会被打成批级 400。
        Set<String> allMonths = monthsByPhase.values().stream().flatMap(Set::stream).collect(Collectors.toSet());
        if (!allMonths.isEmpty()) reviewGuard.assertEditable(ReviewKind.ELEC_COST, allMonths, null);
        monthsByPhase.forEach((phaseId, months) -> records.deleteByPhaseAndMonths(phaseId, new ArrayList<>(months)));
        int imported = 0;
        for (ElecImportRequest.Row row : valid) {
            boolean energy = !"basic".equals(row.type());
            ElecRecord r = new ElecRecord();
            r.setType(row.type());
            r.setPhaseId(row.phaseId());
            r.setAcctMonth(row.acctMonth());
            r.setInvDate(row.invDate() == null || row.invDate().isBlank() ? null : row.invDate());
            r.setPeriod(energy ? (row.period() == null || row.period().isBlank() ? null : row.period()) : null);
            r.setCat(energy ? row.cat() : null);
            r.setUnit(energy ? row.unit() : null);
            r.setQty(energy ? r2(row.qty()) : null);
            r.setDemand(energy ? null : r2(row.demand()));
            r.setPrice(nz(row.price()).setScale(6, RoundingMode.HALF_UP));
            r.setRate(nz(row.rate()).setScale(4, RoundingMode.HALF_UP));
            r.setNote(row.note() == null || row.note().isBlank() ? null : row.note());
            r.setSource("import");
            records.insert(r);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // 校验 acctMonth 形如 YYYY-MM 且年 2000-2100、月 1-12
    private static boolean validMonth(String s) {
        if (s == null) return false;
        Matcher m = YM.matcher(s);
        if (!m.matches()) return false;
        int y = Integer.parseInt(m.group(1)), mon = Integer.parseInt(m.group(2));
        return y >= 2000 && y <= 2100 && mon >= 1 && mon <= 12;
    }

    // ── clearImported(year):删本年 source='import' 行,返回删除计数 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO clearImported(int year) {
        // 只有年、没有月:整年清空会碰到该年任何一个已审月,所以 12 个月一起送闸
        assertYearEditable(year);
        return new DeleteResultDTO(records.deleteImported(year), 0);
    }

    // ── batchDelete(ids):按 id 删(seed/manual/import 同等可删);不存在的 id 静默忽略,skipped 恒 0 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO batchDelete(List<Long> ids) {
        int deleted = 0;
        for (Long id : ids) {
            ElecRecord r = records.selectById(id);
            if (r == null) continue;
            // 一批 id 可跨月:逐行按被删行自己的月判(同一 @Transactional,命中即整批回滚)
            assertElecEditable(r.getAcctMonth());
            records.deleteById(id);
            deleted++;
        }
        return new DeleteResultDTO(deleted, 0);
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
