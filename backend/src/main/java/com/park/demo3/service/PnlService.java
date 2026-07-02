package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.PnlImportRequest;
import com.park.demo3.dto.PnlOverviewDTO;
import com.park.demo3.dto.PnlOverviewDTO.YearMeta;
import com.park.demo3.dto.PnlRowDTO;
import com.park.demo3.dto.PnlSaveRequest;
import com.park.demo3.dto.PnlYearDTO;
import com.park.demo3.entity.PnlRow;
import com.park.demo3.mapper.PnlRowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class PnlService {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private static final List<String> SCHEDULES = List.of("s1", "s2", "s3", "s4", "s5");
    private final PnlRowMapper rows;

    public PnlService(PnlRowMapper rows) { this.rows = rows; }

    private static void check(String schedule) {
        if (!SCHEDULES.contains(schedule)) throw new BizException(ResultCode.BAD_REQUEST, "未知附表");
    }
    // NULL 保留(未录,区分 0),非空四舍五入到分
    private static BigDecimal r2n(BigDecimal v) { return v == null ? null : v.setScale(2, RoundingMode.HALF_UP); }

    // kind:客端已识别则存其值;否则按标签识别(损益→pnl、小计→subtotal、合计|总计→total、否则 detail)
    static String kindOf(String kind, String label) {
        if (kind != null && !kind.isBlank()) return kind;
        String l = label == null ? "" : label;
        if (l.contains("损益")) return "pnl";
        if (l.contains("小计")) return "subtotal";
        if (l.contains("合计") || l.contains("总计")) return "total";
        return "detail";
    }

    // ── overview:年份范围 = [min(BASE,最小数据年) .. max(数据年)+1];无数据 → [2024..2025] ──
    public PnlOverviewDTO overview(String schedule) {
        check(schedule);
        Map<Integer, Integer> countByYear = new LinkedHashMap<>();
        for (Map<String, Object> m : rows.years(schedule)) {
            countByYear.put(((Number) m.get("year")).intValue(), ((Number) m.get("cnt")).intValue());
        }
        int lo = Math.min(BASE_YEAR, countByYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));
        int hi = countByYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(BASE_YEAR) + 1;
        List<YearMeta> years = new ArrayList<>();
        for (int y = lo; y <= hi; y++) {
            years.add(new YearMeta(y, countByYear.containsKey(y), countByYear.getOrDefault(y, 0)));
        }
        return new PnlOverviewDTO(years);
    }

    // ── 某年全部行(按 sort_order) ──
    public PnlYearDTO year(String schedule, int year) {
        check(schedule);
        return new PnlYearDTO(year, rows.year(schedule, year).stream().map(PnlService::toDTO).toList());
    }

    // ── 保存整年(clear+insert;row_key 服务端按行序合成 r<n>) ──
    @Transactional
    public PnlYearDTO save(String schedule, int year, PnlSaveRequest req) {
        check(schedule);
        clear(schedule, year);
        insertRows(schedule, year, req == null ? null : req.rows());
        return year(schedule, year);
    }

    // ── 导入整年(clear+insert,imported=行数) ──
    @Transactional
    public ImportResultDTO importRows(String schedule, int year, PnlImportRequest req) {
        check(schedule);
        clear(schedule, year);
        int imported = insertRows(schedule, year, req == null ? null : req.rows());
        return new ImportResultDTO(imported, 0, List.of());
    }

    // ── helpers ──
    private void clear(String schedule, int year) {
        rows.delete(new QueryWrapper<PnlRow>().eq("schedule", schedule).eq("year", year));
    }

    private int insertRows(String schedule, int year, List<PnlRowDTO> dtos) {
        if (dtos == null) return 0;
        int n = 0;
        for (PnlRowDTO dto : dtos) {
            PnlRow r = new PnlRow();
            r.setSchedule(schedule);
            r.setYear(year);
            r.setRowKey("r" + (n + 1));
            r.setGroupLabel(dto.groupLabel() == null ? "" : dto.groupLabel());
            r.setLabel(dto.label());
            r.setKind(kindOf(dto.kind(), dto.label()));
            r.setNote(dto.note() == null || dto.note().isBlank() ? null : dto.note());
            List<BigDecimal> m = dto.m();
            BigDecimal[] v = new BigDecimal[12];
            if (m != null) for (int i = 0; i < Math.min(12, m.size()); i++) v[i] = r2n(m.get(i));
            r.setM1(v[0]); r.setM2(v[1]); r.setM3(v[2]); r.setM4(v[3]);
            r.setM5(v[4]); r.setM6(v[5]); r.setM7(v[6]); r.setM8(v[7]);
            r.setM9(v[8]); r.setM10(v[9]); r.setM11(v[10]); r.setM12(v[11]);
            r.setSortOrder(n);
            rows.insert(r);
            n++;
        }
        return n;
    }

    private static PnlRowDTO toDTO(PnlRow r) {
        return new PnlRowDTO(r.getRowKey(), r.getGroupLabel(), r.getLabel(), r.getKind(), r.getNote(),
            Arrays.asList(r.getM1(), r.getM2(), r.getM3(), r.getM4(), r.getM5(), r.getM6(),
                          r.getM7(), r.getM8(), r.getM9(), r.getM10(), r.getM11(), r.getM12()),
            r.getSortOrder() == null ? 0 : r.getSortOrder());
    }
}
