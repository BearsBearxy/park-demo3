package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Stream;

/**
 * data-home 只读聚合：所有数字从已建子系统真实数据派生。零新表、零迁移、不读 new Date()。
 * 本期 = 跨 5 个月度类子系统中"有数据的最新 (年,月)"的 max。
 */
@Service
public class DataHomeService {

    private final MonthlyLedgerMapper ledger;
    private final S10RecordMapper s10;
    private final SalaryRecordMapper salary;
    private final OfficeRecordMapper office;
    private final PvRecordMapper pv;
    private final ChargingRecordMapper charging;
    private final ElecRecordMapper elec;
    private final ContractService contractService;

    public DataHomeService(MonthlyLedgerMapper ledger, S10RecordMapper s10, SalaryRecordMapper salary,
                           OfficeRecordMapper office, PvRecordMapper pv, ChargingRecordMapper charging,
                           ElecRecordMapper elec, ContractService contractService) {
        this.ledger = ledger; this.s10 = s10; this.salary = salary; this.office = office;
        this.pv = pv; this.charging = charging; this.elec = elec; this.contractService = contractService;
    }

    private static final DateTimeFormatter MD = DateTimeFormatter.ofPattern("M/d");
    private static final DateTimeFormatter MD_HM = DateTimeFormatter.ofPattern("M/d HH:mm");

    /** 一个数据源在本期的取数结果：本期行的 updated_at 列表(用于 status/updated/count/recent)。 */
    private record SourceData(String name, String tag, String go, boolean yearly,
                              List<LocalDateTime> updatedAts) {
        boolean done() { return !updatedAts.isEmpty(); }
        LocalDateTime maxUpdated() { return updatedAts.stream().max(Comparator.naturalOrder()).orElse(null); }
    }

    public DataHomeOverviewDTO overview() {
        // ── 本期(year,month) = 5 个月度类子系统有数据的最新 (年,月) 的 max ──
        YearMonth period = currentPeriod();
        int year = period.getYear(), month = period.getMonthValue();
        String acctMonth = period.format(DateTimeFormatter.ofPattern("yyyy-MM"));

        // ── 9 个数据源本期取数(确定性顺序：契约表格序) ──
        List<SourceData> sources = new ArrayList<>(9);
        // 月度类(本月)
        sources.add(monthly("月度台账", "凭证", "ledger",
            ledger.selectList(new QueryWrapper<MonthlyLedger>()
                .eq("period_year", year).eq("period_month", month)), MonthlyLedger::getUpdatedAt));
        sources.add(monthly("销售收入", "附10", "sales-income",
            concat(s10.selectBySlot(1, acctMonth), s10.selectBySlot(2, acctMonth),
                   s10.selectBySlot(3, acctMonth), s10.selectBySlot(4, acctMonth)),
            S10Record::getUpdatedAt));
        sources.add(monthly("工资明细", "附12", "salary",
            salary.selectByMonth(acctMonth), SalaryRecord::getUpdatedAt));
        sources.add(monthly("办公水电", "附13", "utilities",
            office.selectByScheduleAndYear(13, year).stream()
                .filter(r -> acctMonth.equals(r.getAcctMonth())).toList(), OfficeRecord::getUpdatedAt));
        sources.add(monthly("三期水电", "附14", "utilities",
            office.selectByScheduleAndYear(14, year).stream()
                .filter(r -> acctMonth.equals(r.getAcctMonth())).toList(), OfficeRecord::getUpdatedAt));
        // 年度类(本年)
        sources.add(yearly("光伏发电", "附6", "pv-income",
            pv.selectByYear(year), PvRecord::getUpdatedAt));
        sources.add(yearly("汽车充电桩", "附7", "car-charging",
            charging.selectByScheduleAndYear(7, year), ChargingRecord::getUpdatedAt));
        sources.add(yearly("电动车充电桩", "附8", "ebike-charging",
            charging.selectByScheduleAndYear(8, year), ChargingRecord::getUpdatedAt));
        sources.add(yearly("电费成本", "附11", "elec-cost",
            concat(elec.selectByYearAndType(year, "energy"), elec.selectByYearAndType(year, "basic")),
            ElecRecord::getUpdatedAt));

        // ── 9 源 DTO ──
        List<DataHomeSourceDTO> sourceDtos = sources.stream()
            .map(s -> new DataHomeSourceDTO(s.name(), s.tag(),
                s.done() ? "done" : "missing",
                s.done() ? s.maxUpdated().format(MD) : "—",
                s.go()))
            .toList();

        int progressTotal = 9;
        int progressDone = (int) sources.stream().filter(SourceData::done).count();
        int pct = (int) Math.round(progressDone * 100.0 / progressTotal);

        // ── 本期待办：missing 源 + 合同 expiring ──
        List<DataHomeTaskDTO> tasks = new ArrayList<>();
        for (SourceData s : sources) {
            if (!s.done()) {
                tasks.add(new DataHomeTaskDTO(
                    s.name() + " 本期未录入",
                    "本期 " + year + "年" + month + "月 暂无数据",
                    "去录入", s.go(), "warning"));
            }
        }
        int expiring = contractService.summary().contractExpiring();
        if (expiring > 0) {
            tasks.add(new DataHomeTaskDTO(
                expiring + " 份合同即将到期待续签",
                "本月需关注续签", "查看合同", "contracts", "warning"));
        }
        // 按 sev 再按 label 稳定排序(确定性)
        tasks.sort(Comparator.comparingInt(DataHomeService::sevRank)
            .thenComparing(DataHomeTaskDTO::label));

        // ── 最近动态：跨 9 源 updated_at 最新 6 条 ──
        record RecentRow(String source, String period, LocalDateTime t) {}
        List<RecentRow> recentRows = new ArrayList<>();
        for (SourceData s : sources) {
            String periodLabel = s.yearly() ? year + "年" + month + "月" : acctMonth;
            for (LocalDateTime t : s.updatedAts()) {
                if (t != null) recentRows.add(new RecentRow(s.name(), periodLabel, t));
            }
        }
        recentRows.sort(Comparator.comparing(RecentRow::t).reversed());
        List<DataHomeRecentDTO> recent = recentRows.stream().limit(6)
            .map(r -> new DataHomeRecentDTO(r.source(), r.period(), r.t().format(MD_HM)))
            .toList();

        // ── KPI 4 枚 ──
        int recordCount = sources.stream().mapToInt(s -> s.updatedAts().size()).sum();
        LocalDateTime globalMax = recentRows.stream().map(RecentRow::t)
            .max(Comparator.naturalOrder()).orElse(null);
        String maxSource = globalMax == null ? null
            : recentRows.stream().filter(r -> r.t().equals(globalMax))
                .map(RecentRow::source).findFirst().orElse(null);

        List<DataHomeKpiDTO> kpis = List.of(
            new DataHomeKpiDTO("数据完整度", pct + "%", progressDone + " / 9 项", "slate", "clipboard-check"),
            new DataHomeKpiDTO("待处理事项", String.valueOf(tasks.size()), "本期待补", "sky", "list-todo"),
            new DataHomeKpiDTO("本期记录数", String.valueOf(recordCount), "本期已录", "blue", "files"),
            new DataHomeKpiDTO("最近更新",
                globalMax == null ? "—" : globalMax.format(DateTimeFormatter.ofPattern("HH:mm")),
                globalMax == null ? "暂无" : globalMax.format(MD) + " · " + maxSource,
                "cyan", "upload"));

        return new DataHomeOverviewDTO(
            new DataHomeOverviewDTO.Period(year, month, year + "年" + month + "月"),
            progressDone, progressTotal, pct,
            kpis, sourceDtos, tasks, recent);
    }

    // ── 本期口径：5 个月度类子系统有数据的最新 (年,月) 的 max；无数据兜底当前无意义，回退 (0,1) 不会发生(种子保证有数据) ──
    // I/O：原来把 5 张月度表整表读成实体只为取 MAX 两列(monthly_ledger 近两万行 × 21 个 DECIMAL 列)，
    // 而 data-home 是登录后第一屏、每次刷新都跑。改为 4 条聚合查询，各回 1 个标量；口径与原逐行取 max 逐条等价。
    private YearMonth currentPeriod() {
        List<YearMonth> candidates = new ArrayList<>();
        // 月度台账：MAX(period_year*100+period_month)。月∈[1,12] 时该编码与 YearMonth 的(年,月)字典序严格同序；
        // 任一列为 NULL 则整个表达式为 NULL 被 MAX 忽略——与原来"两列都非 null 才计入"完全一致。
        for (Object o : ledger.selectObjs(new QueryWrapper<MonthlyLedger>()
                .select("MAX(period_year * 100 + period_month)"))) {
            // 空表时聚合返回一行 NULL(不是空结果集)，instanceof 挡掉 → 不产生候选，与原来空 List 不产生候选一致
            if (o instanceof Number n) candidates.add(YearMonth.of(n.intValue() / 100, n.intValue() % 100));
        }
        // s10 / salary / office(13,14)：acct_month 是 'YYYY-MM' 定长零填充，字符串 MAX == 时序 MAX。
        // 脏值口径与原逐行 parse-忽略不严格等价(排序在合法值之上的畸形串会顶掉真最大月)，但三张表
        // acct_month 均 NOT NULL CHAR/VARCHAR(7) 且全部写入路径经应用层 \d{4}-\d{2} 校验，造不出脏行。
        addAcctMonth(candidates, s10.selectObjs(new QueryWrapper<S10Record>().select("MAX(acct_month)")));
        addAcctMonth(candidates, salary.selectObjs(new QueryWrapper<SalaryRecord>().select("MAX(acct_month)")));
        // 13/14 原本分两次取整表再一起求 max，并成一条 IN 查询求并集 MAX 等价(走 idx_office_sched_acct)
        addAcctMonth(candidates, office.selectObjs(new QueryWrapper<OfficeRecord>()
            .select("MAX(acct_month)").in("schedule_no", 13, 14)));
        return candidates.stream().max(Comparator.naturalOrder()).orElse(YearMonth.of(2000, 1));
    }

    /** 聚合结果按元素判空：空表回一行 NULL，非法/畸形串经 parseAcctMonth 返回 null 后同样不产生候选。 */
    private static void addAcctMonth(List<YearMonth> out, List<Object> maxRow) {
        for (Object o : maxRow) {
            if (!(o instanceof String s)) continue;
            YearMonth ym = parseAcctMonth(s);
            if (ym != null) out.add(ym);
        }
    }

    private static YearMonth parseAcctMonth(String acctMonth) {
        if (acctMonth == null || acctMonth.length() < 7) return null;
        try {
            return YearMonth.of(Integer.parseInt(acctMonth.substring(0, 4)),
                                Integer.parseInt(acctMonth.substring(5, 7)));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static <T> SourceData monthly(String name, String tag, String go,
                                          List<T> rows, Function<T, LocalDateTime> getUpdated) {
        return new SourceData(name, tag, go, false, updatedAts(rows, getUpdated));
    }

    private static <T> SourceData yearly(String name, String tag, String go,
                                         List<T> rows, Function<T, LocalDateTime> getUpdated) {
        return new SourceData(name, tag, go, true, updatedAts(rows, getUpdated));
    }

    private static <T> List<LocalDateTime> updatedAts(List<T> rows, Function<T, LocalDateTime> getUpdated) {
        return rows.stream().map(getUpdated).toList();
    }

    @SafeVarargs
    private static <T> List<T> concat(List<T>... lists) {
        List<T> out = new ArrayList<>();
        for (List<T> l : lists) out.addAll(l);
        return out;
    }

    private static int sevRank(DataHomeTaskDTO t) {
        return switch (t.sev()) {
            case "danger" -> 0;
            case "warning" -> 1;
            default -> 2; // info
        };
    }

    // ══ 锚定月与 months 全集(spec §2.2) ══════════════════════════════════════════════
    // 首页只服务「录入的人」,所以锚必须落在他接着要干活的那个月。三个候选实测下来只有一个可用:
    //   ✗ 「最早未完工月」—— 覆盖矩阵实测:没有任何一个月是全做完的(出账链只在 2023-08/10、2024-02
    //      三个样本月跑过,台账/附表是 2025 全年,两边根本不重叠),该口径恒落 2023-08,
    //      首页会永远停在两年前指着一堆不打算补的历史缺口。
    //   ✗ 「最新有数据月」—— 即改版前的口径(5 个月度源取 max = 2026-01),出账链在该月完全为空,
    //      完整度永远停在 20% 上下,天天打开先被数落一遍。
    //   ✓ 「出账链最新有数据月」—— 正是用户接着往下补的位置;补到 2024-03 锚自动前移,
    //      零新增状态、零配置、自动推进。

    /** 锚定月三级回退:出账链最新月 → 附表最新月(已导附表尚未跑链的库) → null(全新库)。
     *  ym 是零补 YYYY-MM,字典序即时间序,不解析成 YearMonth 再比。 */
    static String anchorYm(List<String> chainYms, List<String> scheduleYms) {
        String chain = chainYms.stream().max(Comparator.naturalOrder()).orElse(null);
        if (chain != null) return chain;
        return scheduleYms.stream().max(Comparator.naturalOrder()).orElse(null);
    }

    /** 顶部月份下拉的可切月份:链 ∪ 附表,升序去重。
     *  不能只给链的月份 —— 用户要能切到 2025-06 补台账,而那个月链上一条数据都没有。 */
    static List<String> allMonths(List<String> chainYms, List<String> scheduleYms) {
        return Stream.concat(chainYms.stream(), scheduleYms.stream()).distinct().sorted().toList();
    }

    // ══ 出账链 4 步(spec §2.1) ══════════════════════════════════════════════════════
    // 只画 4 步不画 6 步:合同与参数**不按月完成** —— 合同的「待补档案」是全局档案缺口,
    // 参数是版本簿 —— 塞进流水线会得到两个永远不知道该不该打勾的格子。
    // 它们改由 buildBlockers 承担:只在有问题时渲染,没问题时整条不出现。

    /** 出账链 4 步。当前步 = 第一个非 done;全 done → currentIndex=-1,前端把大卡换成「去对账核对」。
     *  ⚠ 抄表 detail 只给「已抄 N 块」不给分母:92/94 那个比例是 MeterView 前端 cardCounts()
     *    在电水+分区筛选链上算的,后端另算一份分母必然与之漂移(METRIC-SOURCE-SPEC §1
     *    禁止同一判定两份实现)。首页只回答「做没做、做了多少」,比例留在抄表屏。 */
    static DataHomeOverviewDTO.Chain buildChain(long readingCount, boolean poolGenerated, boolean lossGenerated,
                                                int noticeCount, BigDecimal noticeTotal, int noticeWarn) {
        boolean[] done   = { readingCount > 0, poolGenerated, lossGenerated, noticeCount > 0 };
        String[]  keys   = { "meters", "alloc", "alloc-loss", "bill-notices" };
        String[]  labels = { "园区抄表", "公共电核算", "楼栋损耗", "催缴单" };
        String[]  details = {
            readingCount > 0 ? "已抄 " + readingCount + " 块" : "未抄表",
            poolGenerated ? "" : "未生成",
            lossGenerated ? "" : "未生成",
            noticeCount > 0
                ? noticeCount + " 户 · ¥" + noticeTotal.setScale(2, RoundingMode.HALF_UP).toPlainString()
                  + (noticeWarn > 0 ? " · " + noticeWarn + " 户带警告" : "")
                : "未生成",
        };
        int current = -1;
        for (int i = 0; i < 4; i++) if (!done[i]) { current = i; break; }

        List<DataHomeOverviewDTO.Step> steps = new ArrayList<>(4);
        for (int i = 0; i < 4; i++) {
            String status = done[i] ? "done" : (i == current ? "current" : "todo");
            steps.add(new DataHomeOverviewDTO.Step(keys[i], labels[i], status, details[i], keys[i]));
        }
        return new DataHomeOverviewDTO.Chain(current, steps);
    }
}
