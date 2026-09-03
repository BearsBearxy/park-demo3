package com.park.demo3.service;

import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

class DataHomeServiceTest {
    MonthlyLedgerMapper ledger = Mockito.mock(MonthlyLedgerMapper.class);
    S10RecordMapper s10 = Mockito.mock(S10RecordMapper.class);
    SalaryRecordMapper salary = Mockito.mock(SalaryRecordMapper.class);
    OfficeRecordMapper office = Mockito.mock(OfficeRecordMapper.class);
    PvRecordMapper pv = Mockito.mock(PvRecordMapper.class);
    ChargingRecordMapper charging = Mockito.mock(ChargingRecordMapper.class);
    ElecRecordMapper elec = Mockito.mock(ElecRecordMapper.class);
    ContractService contractService = Mockito.mock(ContractService.class);
    MeterReadingMapper meterReadings = Mockito.mock(MeterReadingMapper.class);
    AllocPoolResultMapper poolResults = Mockito.mock(AllocPoolResultMapper.class);
    AllocLossResultMapper lossResults = Mockito.mock(AllocLossResultMapper.class);
    BillNoticeMapper billNotices = Mockito.mock(BillNoticeMapper.class);
    ParamService paramService = Mockito.mock(ParamService.class);

    DataHomeService svc = new DataHomeService(ledger, s10, salary, office, pv, charging, elec, contractService,
        meterReadings, poolResults, lossResults, billNotices, paramService);

    // ── helpers ──
    S10Record s10Row(String acctMonth, int phase, LocalDateTime updated) {
        S10Record r = new S10Record(); r.setAcctMonth(acctMonth); r.setPhase(phase); r.setUpdatedAt(updated);
        return r;
    }
    SalaryRecord salaryRow(String acctMonth, LocalDateTime updated) {
        SalaryRecord r = new SalaryRecord(); r.setAcctMonth(acctMonth); r.setUpdatedAt(updated); return r;
    }
    OfficeRecord officeRow(int scheduleNo, String acctMonth, LocalDateTime updated) {
        OfficeRecord r = new OfficeRecord();
        r.setScheduleNo(scheduleNo); r.setAcctMonth(acctMonth); r.setUpdatedAt(updated); return r;
    }
    PvRecord pvRow(String acctMonth, LocalDateTime updated) {
        PvRecord r = new PvRecord(); r.setAcctMonth(acctMonth); r.setUpdatedAt(updated); return r;
    }
    ChargingRecord chargingRow(int scheduleNo, String acctMonth, LocalDateTime updated) {
        ChargingRecord r = new ChargingRecord();
        r.setScheduleNo(scheduleNo); r.setAcctMonth(acctMonth); r.setUpdatedAt(updated); return r;
    }
    ElecRecord elecRow(String acctMonth, String type, LocalDateTime updated) {
        ElecRecord r = new ElecRecord(); r.setAcctMonth(acctMonth); r.setType(type); r.setUpdatedAt(updated); return r;
    }
    ContractSummaryDTO summary(int expiring) {
        return new ContractSummaryDTO(10, 5, expiring, 1, java.math.BigDecimal.ZERO);
    }

    /**
     * 默认全部 mapper 返回空(所有源 missing)；按需在测试里覆盖。
     * 本期口径走聚合查询：selectObjs 回一个标量(ledger 是 year*100+month 编码，其余是 acct_month 字符串)。
     */
    void stubAllEmpty() {
        when(ledger.selectList(any())).thenReturn(List.of());
        when(ledger.<Object>selectObjs(any())).thenReturn(List.of());
        when(s10.<Object>selectObjs(any())).thenReturn(List.of());
        when(s10.selectBySlot(anyInt(), anyString())).thenReturn(List.of());
        when(salary.<Object>selectObjs(any())).thenReturn(List.of());
        when(salary.selectByMonth(anyString())).thenReturn(List.of());
        when(office.<Object>selectObjs(any())).thenReturn(List.of());
        when(office.selectByScheduleAndYear(anyInt(), anyInt())).thenReturn(List.of());
        when(pv.selectByYear(anyInt())).thenReturn(List.of());
        when(charging.selectByScheduleAndYear(anyInt(), anyInt())).thenReturn(List.of());
        when(elec.selectByYearAndType(anyInt(), anyString())).thenReturn(List.of());
        when(contractService.summary()).thenReturn(summary(0));
        // 出账链四源:空库(4 步全 todo);contractService.list 空 → 无合同缺口;参数不 stale
        when(meterReadings.selectDistinctYms()).thenReturn(List.of());
        when(poolResults.selectDistinctYms()).thenReturn(List.of());
        when(lossResults.selectDistinctYms()).thenReturn(List.of());
        when(billNotices.selectDistinctYms()).thenReturn(List.of());
        when(meterReadings.selectCount(any())).thenReturn(0L);
        when(poolResults.selectCount(any())).thenReturn(0L);
        when(lossResults.selectCount(any())).thenReturn(0L);
        when(billNotices.selectList(any())).thenReturn(List.of());
        when(contractService.list(any())).thenReturn(List.of());
        when(paramService.status(anyString())).thenReturn(
            new ParamStatusDTO(0, 0, 0, null, null, null, false, List.of()));
    }

    // ══ 旧契约的 7 个测试已随重设计删除 ══════════════════════════════
    // period_isMaxAcrossMonthlySubsystems / period_allTablesEmpty… → 锚口径已换
    //   (5 个月度源取 max → 出账链最新月),由下方「锚定月_*」四条取代;
    // missingSources_generateWarningTasks / contractExpiring_addsTask → 待办已删。
    //   待办本就是 sources 的子集(旧 service 直接遍历同一个 sources 生成 tasks),
    //   这正是本次重设计要消灭的重复,不存在等价替换;
    // recent_top6_orderedByUpdatedDesc → 最近动态已从产品上移除(spec §2);
    // kpis_deriveCountsAndMaxUpdate → 4 个 KPI 卡里 3 个是下方栏目的重复,整组删除。

    @Test
    void 附表项_已录与未录() {
        stubAllEmpty();
        when(salary.selectByMonth("2026-06"))
            .thenReturn(List.of(salaryRow("2026-06", LocalDateTime.of(2026, 6, 5, 8, 30))));

        DataHomeOverviewDTO o = svc.overview("2026-06");
        assertThat(o.schedules().items()).hasSize(9);
        assertThat(o.schedules().total()).isEqualTo(9);
        assertThat(o.schedules().done()).isEqualTo(1);
        assertThat(o.schedules().items()).filteredOn(i -> i.name().equals("工资明细"))
            .allMatch(DataHomeOverviewDTO.Item::done);
        assertThat(o.schedules().items()).filteredOn(i -> i.name().equals("月度台账"))
            .noneMatch(DataHomeOverviewDTO.Item::done);
    }

    @Test
    void 全新库_period为null且不炸() {
        stubAllEmpty();
        DataHomeOverviewDTO o = svc.overview(null);
        assertThat(o.period()).isNull();
        assertThat(o.months()).isEmpty();
        assertThat(o.chain().currentIndex()).isZero();
        assertThat(o.schedules().done()).isZero();
    }

    // ══ 锚定月与 months 全集(spec §2.2) ══════════════════════════════
    // 纯函数,不碰 mapper —— 锚口径是本次重设计的核心决策,值得单独钉死。

    @Test void 锚定月_取出账链最新月() {
        assertThat(DataHomeService.anchorYm(List.of("2023-08", "2023-10", "2024-02"), List.of("2025-10")))
            .isEqualTo("2024-02");
    }

    @Test void 锚定月_链为空时退到附表最新月() {
        assertThat(DataHomeService.anchorYm(List.of(), List.of("2025-01", "2025-10"))).isEqualTo("2025-10");
    }

    @Test void 锚定月_两边都空返回null() {
        assertThat(DataHomeService.anchorYm(List.of(), List.of())).isNull();
    }

    @Test void months全集_并集去重升序() {
        assertThat(DataHomeService.allMonths(List.of("2024-02", "2023-08"), List.of("2025-01", "2024-02")))
            .containsExactly("2023-08", "2024-02", "2025-01");
    }

    // ══ 出账链 4 步(spec §2.1) ══════════════════════════════════════
    @Test void 出账链_当前步是第一个非done() {
        var chain = DataHomeService.buildChain(6, 6, 1088, true, true, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.currentIndex()).isEqualTo(4);
        assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::status)
            .containsExactly("done", "done", "done", "done", "current");
        assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::key)
            .containsExactly("params", "meters", "alloc", "alloc-loss", "bill-notices");
    }

    @Test void 出账链_催缴单detail报张数不报户数() {
        // bill_notice 一租户可有多行(按收款公司/单据类型拆单);而催缴单屏的「户数」是
        // aggregateByTenant 聚合后、且只算当前期别 tab(默认一期)的数。两者根本不是一个口径,
        // 首页报「张」= 唯一且不会与屏上户数打架(METRIC-SOURCE-SPEC §2)。
        var chain = DataHomeService.buildChain(6, 6, 1, true, true, 295, new java.math.BigDecimal("4107986.54"), 183);
        assertThat(chain.steps().get(4).detail())
            .isEqualTo("295 张 · ¥4107986.54 · 183 张有警告").doesNotContain("户");
    }

    @Test void 出账链_全部完成时currentIndex为负1() {
        var chain = DataHomeService.buildChain(6, 6, 1088, true, true, 102, new java.math.BigDecimal("2474138.88"), 66);
        assertThat(chain.currentIndex()).isEqualTo(-1);
        assertThat(chain.steps()).allMatch(s -> "done".equals(s.status()));
    }

    @Test void 出账链_空月第一步为current其余todo() {
        var chain = DataHomeService.buildChain(0, 6, 0, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.currentIndex()).isZero();
        assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::status)
            .containsExactly("current", "todo", "todo", "todo", "todo");
    }

    @Test void 出账链_抄表detail只给已抄数不给分母() {
        // 92/94 那个比例是 MeterView 前端 cardCounts() 在电水+分区筛选链上算的,
        // 后端另算一份分母必然与之漂移 —— METRIC-SOURCE-SPEC §1 禁止同一判定两份实现。
        // 首页只回答「这步做没做、做了多少」,比例留在抄表屏(它才有完整筛选口径)。
        var chain = DataHomeService.buildChain(6, 6, 1088, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(1).detail()).isEqualTo("已抄 1088 块").doesNotContain("/");
    }

    // ── 第 1 步「计费参数」(SIDEBAR-UX-REDESIGN §5.1):判据是电价录齐,不是 stale ──
    @Test void 参数步_电价录齐才done() {
        var chain = DataHomeService.buildChain(6, 6, 0, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(0).status()).isEqualTo("done");
        assertThat(chain.steps().get(0).detail()).isEqualTo("本月电价 6/6 已录");
        assertThat(chain.currentIndex()).isEqualTo(1);
    }

    @Test void 参数步_少一键就是current且detail报进度() {
        var chain = DataHomeService.buildChain(5, 6, 1088, true, true, 102, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(0).status()).isEqualTo("current");
        assertThat(chain.steps().get(0).detail()).isEqualTo("本月电价 5/6 已录");
        assertThat(chain.currentIndex()).isZero();
    }

    @Test void 参数步_没有电价键的月不算done且detail未配置() {
        // 全新库分支传 (0, 0):priceTotal 为 0 时 0 == 0 不能算 done —— 那是「没配」不是「配齐」
        var chain = DataHomeService.buildChain(0, 0, 0, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(0).status()).isEqualTo("current");
        assertThat(chain.steps().get(0).detail()).isEqualTo("未配置");
    }

    // ══ 前置条 blockers(spec §2.1) ══════════════════════════════════
    @Test void blockers_都没问题时为空数组() {
        assertThat(DataHomeService.buildBlockers(0, false)).isEmpty();
    }

    @Test void blockers_合同缺计费行时出一条() {
        var bs = DataHomeService.buildBlockers(219, false);
        assertThat(bs).hasSize(1);
        assertThat(bs.get(0).kind()).isEqualTo("contract-gap");
        assertThat(bs.get(0).text()).contains("219");
        assertThat(bs.get(0).go()).isEqualTo("contracts");
    }

    @Test void blockers_参数过期时出一条() {
        var bs = DataHomeService.buildBlockers(0, true);
        assertThat(bs).hasSize(1);
        assertThat(bs.get(0).kind()).isEqualTo("param-stale");
        assertThat(bs.get(0).go()).isEqualTo("params");
    }

    @Test void blockers_两个问题都在时出两条_合同在前() {
        assertThat(DataHomeService.buildBlockers(219, true))
            .extracting(DataHomeOverviewDTO.Blocker::kind)
            .containsExactly("contract-gap", "param-stale");
    }
}
