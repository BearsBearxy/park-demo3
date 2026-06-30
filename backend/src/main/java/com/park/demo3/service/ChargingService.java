package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ChargingCatDTO;
import com.park.demo3.dto.ChargingImportRequest;
import com.park.demo3.dto.ChargingOverviewDTO;
import com.park.demo3.dto.ChargingOverviewDTO.YearMeta;
import com.park.demo3.dto.ChargingRecordDTO;
import com.park.demo3.dto.ChargingRecordReq;
import com.park.demo3.dto.ChargingYearDTO;
import com.park.demo3.dto.ChargingYearDTO.ChargingTotal;
import com.park.demo3.dto.DeleteResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.entity.ChargingCat;
import com.park.demo3.entity.ChargingRecord;
import com.park.demo3.mapper.ChargingCatMapper;
import com.park.demo3.mapper.ChargingRecordMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class ChargingService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final ChargingCatMapper cats;
    private final ChargingRecordMapper records;

    public ChargingService(ChargingCatMapper cats, ChargingRecordMapper records) {
        this.cats = cats; this.records = records;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }

    // 共享派生:profit = fee - cost(绝不落库)
    private static BigDecimal profit(ChargingRecord r) { return r2(nz(r.getFee()).subtract(nz(r.getCost()))); }

    // ── cats(按 sortNo;按 schedule 取) ──
    public List<ChargingCatDTO> cats(int scheduleNo) {
        return cats.selectBySchedule(scheduleNo).stream().map(ChargingService::toCatDTO).toList();
    }

    // ── overview:年份范围 = [2024 .. maxDataYear+1];currentYear = maxDataYear ──
    public ChargingOverviewDTO overview(int scheduleNo) {
        Map<Integer, List<ChargingRecord>> byYear = records.selectBySchedule(scheduleNo).stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1

        List<YearMeta> years = new ArrayList<>();
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));
        for (int y = lo; y <= upper; y++) {
            List<ChargingRecord> rows = byYear.get(y);
            if (rows == null || rows.isEmpty()) {
                years.add(new YearMeta(y, false, BigDecimal.ZERO.setScale(2), 0));
                continue;
            }
            BigDecimal totalProfit = rows.stream().map(ChargingService::profit).reduce(BigDecimal.ZERO, BigDecimal::add);
            years.add(new YearMeta(y, true, r2(totalProfit), rows.size()));
        }
        return new ChargingOverviewDTO(currentYear, years);
    }

    // ── records(schedule,year):该年全部记录升序 + 派生 profit + catName join + 全年合计 + cats ──
    public ChargingYearDTO records(int scheduleNo, int year) {
        Map<String, String> catName = cats.selectBySchedule(scheduleNo).stream()
            .collect(Collectors.toMap(ChargingCat::getCatId, ChargingCat::getName));

        List<ChargingRecord> rows = records.selectByScheduleAndYear(scheduleNo, year);
        List<ChargingRecordDTO> dtos = rows.stream()
            .map(r -> toRecordDTO(r, catName.get(r.getCat()))).toList();

        return new ChargingYearDTO(year, cats(scheduleNo), dtos, total(rows));
    }

    // ── create(source=manual;附表号非法 → 404;路径附表与 body 不一致 → 409;cat 不存在 → 409) ──
    public ChargingRecordDTO create(int no, ChargingRecordReq req) {
        if (no != 7 && no != 8) throw new BizException(ResultCode.NOT_FOUND, "附表不存在");
        if (req.scheduleNo() == null || req.scheduleNo() != no)
            throw new BizException(ResultCode.CONFLICT, "路径与记账附表不一致");
        ChargingCat cat = cats.selectBySchedule(req.scheduleNo()).stream()
            .filter(c -> c.getCatId().equals(req.cat())).findFirst().orElse(null);
        if (cat == null) throw new BizException(ResultCode.CONFLICT, "充电桩类别不存在");

        ChargingRecord r = new ChargingRecord();
        r.setScheduleNo(req.scheduleNo());
        r.setCat(req.cat());
        r.setAcctMonth(req.acctMonth());
        r.setKwh(r2(req.kwh()));
        r.setFee(r2(req.fee()));
        r.setCost(r2(req.cost()));
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note());
        r.setSource("manual");
        records.insert(r);
        return toRecordDTO(records.selectById(r.getId()), cat.getName());
    }

    // ── updateNote(no,id,note;不存在 / 不属本附表 → 404) ──
    public ChargingRecordDTO updateNote(int no, Integer id, String note) {
        ChargingRecord r = records.selectById(id);
        if (r == null || r.getScheduleNo() != no) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        ChargingRecord saved = records.selectById(id);
        return toRecordDTO(saved, catNameOf(saved.getScheduleNo(), saved.getCat()));
    }

    // ── delete(no,id;不存在 / 不属本附表 → 404;seed 同等可删) ──
    public void delete(int no, Integer id) {
        ChargingRecord r = records.selectById(id);
        if (r == null || r.getScheduleNo() != no) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        records.deleteById(id);
    }

    // ── import:每行自带 cat(运营商 cat_id)+acctMonth(YYYY-MM,必填)+kwh/fee/cost。
    //          fee 已由前端按附表口径算好(电动车 no=8 直取/汽车 no=7 减手续费)——后端只入不再算。
    //          按(scheduleNo,cat,acctMonth)upsert:先删被导入(cat,月)的行(任意来源:种子/手动/导入),再逐行 insert(source=import)。
    //          即「导入即覆盖这些(cat,月)」——自动取代假种子,不波及未导入的(cat,月)。
    //          校验 cat 在本附表 charging_cat 白名单、acctMonth 形如 YYYY-MM 且年 2000-2100、月 1-12;非法 → errors 跳过。 ──
    private static final Pattern YM = Pattern.compile("(\\d{4})-(\\d{2})");

    @org.springframework.transaction.annotation.Transactional
    public ImportResultDTO importRows(int scheduleNo, ChargingImportRequest req) {
        if (scheduleNo != 7 && scheduleNo != 8) throw new BizException(ResultCode.NOT_FOUND, "附表不存在");
        Set<String> whitelist = cats.selectBySchedule(scheduleNo).stream()
            .map(ChargingCat::getCatId).collect(Collectors.toSet());

        List<ChargingImportRequest.Row> rows = req.rows();
        List<ChargingImportRequest.Row> valid = new ArrayList<>();
        List<ImportError> errors = new ArrayList<>();
        // 被导入的(cat,月)去重(清空按这些 tuple,不波及未导入的)
        Map<String, String[]> tuples = new LinkedHashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            ChargingImportRequest.Row row = rows.get(i);
            if (row.cat() == null || !whitelist.contains(row.cat())) {
                errors.add(new ImportError(i, String.valueOf(row.cat()), "充电桩类别不在白名单(运营商未建,请先在字典补)"));
                continue;
            }
            if (!validMonth(row.acctMonth())) {
                errors.add(new ImportError(i, String.valueOf(row.acctMonth()), "记账月格式非法(应为 YYYY-MM,年 2000-2100、月 1-12)"));
                continue;
            }
            valid.add(row);
            tuples.putIfAbsent(row.cat() + "|" + row.acctMonth(), new String[]{row.cat(), row.acctMonth()});
        }
        records.deleteByScheduleCatMonths(scheduleNo, new ArrayList<>(tuples.values()));
        int imported = 0;
        for (ChargingImportRequest.Row row : valid) {
            ChargingRecord r = new ChargingRecord();
            r.setScheduleNo(scheduleNo);
            r.setCat(row.cat());
            r.setAcctMonth(row.acctMonth());
            r.setKwh(r2(row.kwh()));
            r.setFee(r2(row.fee()));
            r.setCost(r2(row.cost()));
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

    // ── clearImported(scheduleNo,year):删本附表本年 source='import' 行,返回删除计数 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO clearImported(int scheduleNo, int year) {
        if (scheduleNo != 7 && scheduleNo != 8) throw new BizException(ResultCode.NOT_FOUND, "附表不存在");
        return new DeleteResultDTO(records.deleteImported(scheduleNo, year), 0);
    }

    // ── batchDelete(ids):按 id 删(seed/manual/import 同等可删);不存在的 id 静默忽略,skipped 恒 0 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO batchDelete(List<Long> ids) {
        int deleted = 0;
        for (Long id : ids) {
            ChargingRecord r = records.selectById(id);
            if (r == null) continue;
            records.deleteById(id);
            deleted++;
        }
        return new DeleteResultDTO(deleted, 0);
    }

    // ── helpers ──
    private String catNameOf(int scheduleNo, String catId) {
        return cats.selectBySchedule(scheduleNo).stream()
            .filter(c -> c.getCatId().equals(catId)).map(ChargingCat::getName).findFirst().orElse(null);
    }

    private static ChargingTotal total(List<ChargingRecord> rows) {
        BigDecimal kwh = BigDecimal.ZERO, fee = BigDecimal.ZERO,
                   cost = BigDecimal.ZERO, prof = BigDecimal.ZERO;
        for (ChargingRecord r : rows) {
            kwh = kwh.add(nz(r.getKwh()));
            fee = fee.add(nz(r.getFee()));
            cost = cost.add(nz(r.getCost()));
            prof = prof.add(profit(r));
        }
        return new ChargingTotal(r2(kwh), r2(fee), r2(cost), r2(prof));
    }

    private static ChargingCatDTO toCatDTO(ChargingCat c) {
        return new ChargingCatDTO(c.getCatId(), c.getName(), c.getShortName(), c.getTint());
    }

    private static ChargingRecordDTO toRecordDTO(ChargingRecord r, String catName) {
        return new ChargingRecordDTO(
            r.getId(), r.getScheduleNo(), r.getCat(), catName,
            r.getAcctMonth(),
            r2(r.getKwh()), r2(r.getFee()), r2(r.getCost()),
            profit(r), r.getNote(), r.getSource());
    }
}
