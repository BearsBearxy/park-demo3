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
    // 出账链四源(spec §2.1):各自的 selectDistinctYms 是上一轮为干掉逐月探测加的,这里正好复用定锚
    private final MeterReadingMapper meterReadings;
    private final AllocPoolResultMapper poolResults;
    private final AllocLossResultMapper lossResults;
    private final BillNoticeMapper billNotices;
    private final ParamService paramService;

    public DataHomeService(MonthlyLedgerMapper ledger, S10RecordMapper s10, SalaryRecordMapper salary,
                           OfficeRecordMapper office, PvRecordMapper pv, ChargingRecordMapper charging,
                           ElecRecordMapper elec, ContractService contractService,
                           MeterReadingMapper meterReadings, AllocPoolResultMapper poolResults,
                           AllocLossResultMapper lossResults, BillNoticeMapper billNotices,
                           ParamService paramService) {
        this.ledger = ledger; this.s10 = s10; this.salary = salary; this.office = office;
        this.pv = pv; this.charging = charging; this.elec = elec; this.contractService = contractService;
        this.meterReadings = meterReadings; this.poolResults = poolResults;
        this.lossResults = lossResults; this.billNotices = billNotices; this.paramService = paramService;
    }


    /** 一个数据源在本期的取数结果：本期行的 updated_at 列表(用于 status/updated/count/recent)。 */
    private record SourceData(String name, String tag, String go, boolean yearly,
                              List<LocalDateTime> updatedAts) {
        boolean done() { return !updatedAts.isEmpty(); }
        LocalDateTime maxUpdated() { return updatedAts.stream().max(Comparator.naturalOrder()).orElse(null); }
    }

    public DataHomeOverviewDTO overview(String ymParam) {
        // ── 锚定月(spec §2.2):出账链最新有数据月 → 附表最新月 → null ──
        List<String> chainYms = chainYms();
        List<String> schedYms = scheduleYms();
        String ym = ymParam != null ? ymParam : anchorYm(chainYms, schedYms);
        List<String> months = allMonths(chainYms, schedYms);

        if (ym == null) {   // 全新库:一条数据都没有,前端出「还没开始出账」引导
            return new DataHomeOverviewDTO(null, months, List.of(),
                buildChain(0, false, false, 0, BigDecimal.ZERO, 0),
                new DataHomeOverviewDTO.Schedules(0, 9, List.of()));
        }

        int year = Integer.parseInt(ym.substring(0, 4)), month = Integer.parseInt(ym.substring(5, 7));

        // ── 出账链 4 步:各源按 ym 存在性判定,走现成索引(idx_meter_reading_ym / uk_pool_result 等) ──
        long readings = meterReadings.selectCount(new QueryWrapper<MeterReading>().eq("ym", ym));
        boolean pool = poolResults.selectCount(new QueryWrapper<AllocPoolResult>().eq("ym", ym)) > 0;
        boolean loss = lossResults.selectCount(new QueryWrapper<AllocLossResult>().eq("ym", ym)) > 0;
        List<BillNotice> notices = billNotices.selectList(new QueryWrapper<BillNotice>().eq("ym", ym));
        BigDecimal noticeTotal = notices.stream().map(BillNotice::getTotalAmount)
            .filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
        int noticeWarn = (int) notices.stream()
            .filter(n -> n.getWarn() != null && !n.getWarn().isBlank()).count();

        // ── 前置条:合同缺口口径**必须**与合同屏同源 ──
        // ContractsView:139 的 gapCounts 跑在全量合同上(注释原话:「不受期数/状态/搜索影响 ——
        // 徽标上的数要和告警里的数对得上」),故这里直接调 contractService.list(null) 取同一份 DTO
        // 再用同一个谓词 billingLineCount==0。不另写 SQL —— 那就是 METRIC-SOURCE-SPEC §1 禁止的
        // 「同一判定两份实现」,首页和合同屏报的数一旦差一份,用户就不知道该信谁。
        // 代价:多读一遍合同+计费行(实测全表扫描 0.5~2ms 级),换口径永不漂移,值。
        int contractNoLine = (int) contractService.list(null).stream()
            .filter(c -> c.billingLineCount() == 0).count();
        boolean paramStale = paramService.status(ym).stale();

        // ── 附表 9 源:保留原有取数与**月/年粒度差异**(月度类按 acctMonth、年度类按 year),
        //    改了会让附表完成度失真 ──
        List<SourceData> sources = scheduleSources(year, month, ym);
        List<DataHomeOverviewDTO.Item> items = sources.stream()
            .map(x -> new DataHomeOverviewDTO.Item(x.name(), x.tag(), x.done(), x.go()))
            .toList();
        int done = (int) sources.stream().filter(SourceData::done).count();

        return new DataHomeOverviewDTO(
            new DataHomeOverviewDTO.Period(year, month, year + "年" + month + "月"),
            months,
            buildBlockers(contractNoLine, paramStale),
            buildChain(readings, pool, loss, notices.size(), noticeTotal, noticeWarn),
            new DataHomeOverviewDTO.Schedules(done, 9, items));
    }

    /** 出账链四源的 distinct 账期并集(升序去重)。四个 selectDistinctYms 是上一轮为干掉
     *  前端逐月探测加的,这里复用 —— 同一份「哪些月有数据」不该有第二种算法。 */
    private List<String> chainYms() {
        return Stream.of(meterReadings.selectDistinctYms(), poolResults.selectDistinctYms(),
                         lossResults.selectDistinctYms(), billNotices.selectDistinctYms())
            .flatMap(List::stream).distinct().sorted().toList();
    }

    /** 5 个月度类附表源的 distinct 账期(年度类 pv/charging/elec 不按月,不参与月份下拉)。
     *  用 DISTINCT 聚合而非整表读实体 —— 沿用旧 currentPeriod() 那次 I/O 优化的考量(该方法已随锚口径变更删除):
     *  data-home 是登录后第一屏、每次刷新都跑,不能为了取几个月份把 monthly_ledger 两万行拉进内存。 */
    private List<String> scheduleYms() {
        Set<String> out = new TreeSet<>();
        for (Object o : ledger.selectObjs(new QueryWrapper<MonthlyLedger>()
                .select("DISTINCT CONCAT(period_year, '-', LPAD(period_month, 2, '0'))"))) {
            if (o instanceof String v) out.add(v);
        }
        addYms(out, s10.selectObjs(new QueryWrapper<S10Record>().select("DISTINCT acct_month")));
        addYms(out, salary.selectObjs(new QueryWrapper<SalaryRecord>().select("DISTINCT acct_month")));
        addYms(out, office.selectObjs(new QueryWrapper<OfficeRecord>()
            .select("DISTINCT acct_month").in("schedule_no", 13, 14)));
        return List.copyOf(out);
    }

    private static void addYms(Set<String> out, List<Object> rows) {
        for (Object o : rows) if (o instanceof String v && parseAcctMonth(v) != null) out.add(v);
    }

    /** 9 个附表源的本期取数。粒度差异是既有口径:月度类按 acctMonth、年度类按 year。 */
    private List<SourceData> scheduleSources(int year, int month, String acctMonth) {
        List<SourceData> sources = new ArrayList<>(9);
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
        sources.add(yearly("光伏发电", "附6", "pv-income",
            pv.selectByYear(year), PvRecord::getUpdatedAt));
        sources.add(yearly("汽车充电桩", "附7", "car-charging",
            charging.selectByScheduleAndYear(7, year), ChargingRecord::getUpdatedAt));
        sources.add(yearly("电动车充电桩", "附8", "ebike-charging",
            charging.selectByScheduleAndYear(8, year), ChargingRecord::getUpdatedAt));
        sources.add(yearly("电费成本", "附11", "elec-cost",
            concat(elec.selectByYearAndType(year, "energy"), elec.selectByYearAndType(year, "basic")),
            ElecRecord::getUpdatedAt));
        return sources;
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
     *  ⚠ 催缴单 detail 给「N 张」不是「N 户」:bill_notice 一租户可有多行(按收款公司/单据类型拆单),
     *    而催缴单屏的「户数」是 aggregateByTenant 聚合后、且只算当前期别 tab 的数(默认一期)。
     *    首页要的是整月全期口径,屏上压根没有这个数 —— 与其重算一份聚合(METRIC-SOURCE-SPEC §1
     *    禁止同一判定两份实现),不如老实报单据张数:口径唯一、不会和屏上的户数打架。
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
                ? noticeCount + " 张 · ¥" + noticeTotal.setScale(2, RoundingMode.HALF_UP).toPlainString()
                  + (noticeWarn > 0 ? " · " + noticeWarn + " 张有警告" : "")
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

    // ══ 前置条 blockers(spec §2.1) ══════════════════════════════════════════════════
    /** 合同/参数不按月完成,不进流水线;只在**有问题时**产出一条,没问题时返回空数组、
     *  前端整条不渲染 —— 没问题的东西不该占版面,这是「有主次」的关键(用户原话:信息量过多、
     *  没有主次)。改版前那 4 个 KPI 卡有 3 个是下方栏目的重复,就是反面教材。
     *  ⚠ 合同缺口口径必须与合同屏 ContractsView 的 noLine 谓词同源(billingLineCount==0),
     *    别在这里另写一套查询(METRIC-SOURCE-SPEC §1)。 */
    static List<DataHomeOverviewDTO.Blocker> buildBlockers(int contractNoLine, boolean paramStale) {
        List<DataHomeOverviewDTO.Blocker> out = new ArrayList<>(2);
        if (contractNoLine > 0)
            out.add(new DataHomeOverviewDTO.Blocker("contract-gap",
                contractNoLine + " 份合同无租金计费行，会让公摊/催缴单算不准", "去补档", "contracts"));
        if (paramStale)
            out.add(new DataHomeOverviewDTO.Blocker("param-stale",
                "计费参数改动晚于本月快照，屏上数字还是改参前派生的", "去重算", "params"));
        return out;
    }
}
