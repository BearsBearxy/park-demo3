package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.DeleteResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.PvImportRequest;
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
public class PvService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final PvPhaseMapper phases;
    private final PvRecordMapper records;
    private final ReviewGuard reviewGuard;

    public PvService(PvPhaseMapper phases, PvRecordMapper records, ReviewGuard reviewGuard) {
        this.phases = phases; this.records = records; this.reviewGuard = reviewGuard;
    }

    /** 附表6 的审核闸(§7.4):园区级表,不带 scope —— p1/p2/p3 是同一张表的行,不是三把键。 */
    private void assertPvEditable(String acctMonth) {
        reviewGuard.assertEditable(ReviewKind.PV, acctMonth, null);
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
        assertPvEditable(req.acctMonth());

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
        assertPvEditable(r.getAcctMonth());
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        PvPhase phase = phases.selectById(r.getPhaseId());
        return toRecordDTO(records.selectById(id), phase == null ? null : phase.getName());
    }

    // ── delete(id;seed 同等可删;不存在 → 404) ──
    public void delete(Integer id) {
        PvRecord r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        assertPvEditable(r.getAcctMonth());
        records.deleteById(id);
    }

    // ── import:每行自带 phaseId(p1/p2/p3)+acctMonth(YYYY-MM,必填)+occurMonth(缺省=acct)。
    //          按(phaseId,acctMonth)upsert:先删被导入(期,月)的行(任意来源:种子/手动/导入),再逐行 insert(source=import)。
    //          即「导入即覆盖这些(期,月)」——自动取代假种子,不波及未导入的(期,月)。
    //          校验 phaseId∈{p1,p2,p3}、acctMonth 形如 YYYY-MM 且年 2000-2100、月 1-12;非法 → errors 跳过。 ──
    private static final Pattern YM = Pattern.compile("(\\d{4})-(\\d{2})");
    private static final Set<String> PHASES = Set.of("p1", "p2", "p3");

    @org.springframework.transaction.annotation.Transactional
    public ImportResultDTO importRows(PvImportRequest req) {
        List<PvImportRequest.Row> rows = req.rows();
        List<PvImportRequest.Row> valid = new ArrayList<>();
        List<ImportError> errors = new ArrayList<>();
        // 被导入的(期,月):按期收集月份集合,逐期删
        Map<String, Set<String>> monthsByPhase = new java.util.LinkedHashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            PvImportRequest.Row row = rows.get(i);
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
        Set<String> months = monthsByPhase.values().stream().flatMap(Set::stream).collect(Collectors.toSet());
        if (!months.isEmpty()) reviewGuard.assertEditable(ReviewKind.PV, months, null);
        monthsByPhase.forEach((phaseId, months2) -> records.deleteByPhaseAndMonths(phaseId, new ArrayList<>(months2)));
        int imported = 0;
        for (PvImportRequest.Row row : valid) {
            String acct = row.acctMonth();
            String occur = (row.occurMonth() == null || row.occurMonth().isBlank()) ? acct : row.occurMonth();
            PvRecord r = new PvRecord();
            r.setPhaseId(row.phaseId());
            r.setAcctMonth(acct);
            r.setOccurMonth(occur);
            r.setSelfKwh(r2(row.selfKwh()));
            r.setSelfAmt(r2(row.selfAmt()));
            r.setGridKwh(r2(row.gridKwh()));
            r.setGridAmt(r2(row.gridAmt()));
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
        // 只有年、没有月:整年清空会碰到该年任何一个已审月,所以 12 个月一起送闸(点名最早的锁月)
        assertYearEditable(year);
        return new DeleteResultDTO(records.deleteImported(year), 0);
    }

    // ── batchDelete(ids):按 id 删(seed/manual/import 同等可删);不存在的 id 静默忽略,skipped 恒 0 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO batchDelete(List<Long> ids) {
        int deleted = 0;
        for (Long id : ids) {
            PvRecord r = records.selectById(id);
            if (r == null) continue;
            // 一批 id 可跨月:逐行按被删行自己的月判(同一 @Transactional,命中即整批回滚)
            assertPvEditable(r.getAcctMonth());
            records.deleteById(id);
            deleted++;
        }
        return new DeleteResultDTO(deleted, 0);
    }

    // ── helpers ──
    /** 整年一条 SQL 的写路径专用:该年 12 个月全送进批量闸。 */
    private void assertYearEditable(int year) {
        List<String> months = new ArrayList<>(12);
        for (int m = 1; m <= 12; m++) months.add(String.format("%04d-%02d", year, m));
        reviewGuard.assertEditable(ReviewKind.PV, months, null);
    }

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
