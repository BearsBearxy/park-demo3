/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.service;

import com.park.demo3.dto.DataHomeOverviewDTO;
import com.park.demo3.dto.ImportCenterDtos.*;
import com.park.demo3.entity.ImportLog;
import com.park.demo3.mapper.ImportLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 导入中心每一行「选中这个月的数有没有」(改稿 T2,用户 2026-10-10 拍板:和本月出账同一套判据)。
 * 台账 / 附表10 / 工资 / 三大报表直接复用 DataHomeService.scheduleSources;本月出账不看的那几类在
 * ImportLogMapper 里各补一条 SQL。合同两类不按月,不查、不算缺。
 */
@Service
public class ImportCoverageService {
    /** 附表10 期号 → 名(同前端 monthClose.logic.ts PHASE_LABEL、DataHomeOverviewDTO.Phase 注释)。 */
    private static final Map<Integer, String> PHASE_LABEL = Map.of(1, "一期", 2, "二期", 3, "三期", 4, "宿舍");
    private static final List<String> MONTH_KEYS = List.of(
        "pv", "charging_7", "charging_8", "elec", "elecCost", "office_13", "office_14",
        "pnl_s1", "pnl_s2", "pnl_s3", "pnl_s4", "pnl_s5");
    /** 按月表里本月出账也看的那几张:key → scheduleSources 的 tag(go 有重名,tag 不重名)。损益附表本月出账不看。 */
    private static final Map<String, String> DATA_HOME_TAG = Map.of(
        "pv", "附6", "charging_7", "附7", "charging_8", "附8", "elec", "附11", "elecCost", "模型",
        "office_13", "附13", "office_14", "附14");

    private final DataHomeService dataHome;
    private final ZoneService zones;
    private final ImportLogMapper logs;

    public ImportCoverageService(DataHomeService dataHome, ZoneService zones, ImportLogMapper logs) {
        this.dataHome = dataHome; this.zones = zones; this.logs = logs;
    }

    public List<CoverageItem> coverage(String ym) {
        YearMonth sel = YearMonth.parse(ym);
        int y = sel.getYear();
        Map<String, ImportLog> lastLog = logs.lastNonRejectedByType().stream()
            .collect(Collectors.toMap(ImportLog::getDataType, l -> l, (a, b) -> a));
        Function<String, Last> last = k -> Optional.ofNullable(lastLog.get(k))
            .map(l -> new Last(l.getCreatedAt(), l.getOperator(), l.getOk() == null ? 0 : l.getOk())).orElse(null);
        List<CoverageItem> out = new ArrayList<>(24);

        // ① 与本月出账同源。go 有重名(utilities、elec-cost 各两条),这里用到的六个不重名
        List<DataHomeService.SourceData> sources = dataHome.scheduleSources(y, sel.getMonthValue(), ym);
        Map<String, DataHomeService.SourceData> src = sources.stream()
            .collect(Collectors.toMap(DataHomeService.SourceData::go, s -> s, (a, b) -> a));
        Map<String, DataHomeService.SourceData> byTag = sources.stream()
            .collect(Collectors.toMap(DataHomeService.SourceData::tag, s -> s, (a, b) -> a));
        out.add(chips("ledger", companyChips(src.get("ledger")), last));
        out.add(chips("s10", src.get("sales-income").phases().stream()
            .map(p -> new Chip(PHASE_LABEL.get(p.no()), String.valueOf(p.no()), p.done())).toList(), last));
        boolean salary = src.get("salary").done();
        out.add(new CoverageItem("salary", "has", null, null, salary, !salary, last.apply("salary")));
        out.add(chips("report_is", companyChips(src.get("income-statement")), last));
        out.add(chips("report_bs", companyChips(src.get("balance-sheet")), last));
        out.add(chips("report_tb", companyChips(src.get("trial-balance")), last));

        // ② 园区抄表:哪个期区这个月有读数;胶囊全集取期区候选(同抄表屏),有行就算(同本月出账「已抄 N 块」)
        Set<String> read = new HashSet<>(logs.meterZonesWithReadings(ym));
        out.add(chips("meter", zones.list().stream()
            .map(z -> new Chip(z.name(), z.code(), read.contains(z.code()))).toList(), last));

        // ③ 光伏 / 充电桩抄表:录到哪天,不限月(选 8 月也写「到 9月30日」)
        LocalDate want = dayWant(sel, LocalDate.now());
        out.add(day("pvMeter", logs.pvReadingMaxDate(), want, last));
        out.add(day("cpMeter", logs.cpReadingMaxDate(), want, last));

        // ④ 按月表:屏上写所选年录到几月(「到 9月」)。缺不缺和本月出账同一套判据(U1):本月出账看的那几张按
        //   「所选月有没有行」判 —— 中间漏导一个月时「到 9月」也算缺;损益附表本月出账不看,仍按「到 N月」早于所选月算缺
        Map<String, String> upTo = new HashMap<>();
        for (Map<String, Object> m : logs.monthUpTo(y + "-")) {
            if (m != null && m.get("v") != null) upTo.put((String) m.get("k"), (String) m.get("v"));
        }
        for (Map<String, Object> m : logs.pnlUpTo(y)) {
            if (m != null && m.get("mon") != null)
                upTo.put("pnl_" + m.get("schedule"), YearMonth.of(y, ((Number) m.get("mon")).intValue()).toString());
        }
        for (String k : MONTH_KEYS) {
            String u = upTo.get(k);
            String tag = DATA_HOME_TAG.get(k);
            boolean missing = tag != null ? !byTag.get(tag).done() : u == null || u.compareTo(ym) < 0;
            out.add(new CoverageItem(k, "month", null, u, null, missing, last.apply(k)));
        }

        // ⑤ 预算:该年有没有预算数(只有往年实际的行不算)
        boolean budget = logs.budgetHasYear(y);
        out.add(new CoverageItem("budget", "year", null, null, budget, !budget, last.apply("budget")));

        // ⑥ 合同两类不按月
        for (String k : List.of("contractFull", "billingTerms"))
            out.add(new CoverageItem(k, "na", null, null, null, false, last.apply(k)));
        return out;
    }

    /** 「到 X月X日」要到哪天才算齐:所选月最后一天;所选月是本月时比到昨天。 */
    static LocalDate dayWant(YearMonth ym, LocalDate today) {
        return ym.equals(YearMonth.from(today)) ? today.minusDays(1) : ym.atEndOfMonth();
    }

    /** 一个胶囊都没有(新园区还没建启用公司)也算缺:本月出账那边台账要有行、报表 allDone 要求公司非空,同口径。 */
    private static CoverageItem chips(String key, List<Chip> chips, Function<String, Last> last) {
        return new CoverageItem(key, "chips", chips, null, null,
            chips.isEmpty() || chips.stream().anyMatch(c -> !c.done()), last.apply(key));
    }

    private static List<Chip> companyChips(DataHomeService.SourceData s) {
        return s.companies().stream()
            .map((DataHomeOverviewDTO.Company c) -> new Chip(c.shortName(), String.valueOf(c.id()), c.done())).toList();
    }

    private static CoverageItem day(String key, LocalDate max, LocalDate want, Function<String, Last> last) {
        return new CoverageItem(key, "day", null, max == null ? null : max.toString(), null,
            max == null || max.isBefore(want), last.apply(key));
    }
}
