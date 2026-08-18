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

    DataHomeService svc = new DataHomeService(ledger, s10, salary, office, pv, charging, elec, contractService);

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
    }

    @Test
    void period_isMaxAcrossMonthlySubsystems() {
        stubAllEmpty();
        // ledger only to 2026-05(编码 202605), salary to 2026-06 → 本期 = 2026年6月
        when(ledger.<Object>selectObjs(any())).thenReturn(List.of(202605L));
        when(salary.<Object>selectObjs(any())).thenReturn(List.of("2026-06"));

        DataHomeOverviewDTO o = svc.overview();
        assertThat(o.period().year()).isEqualTo(2026);
        assertThat(o.period().month()).isEqualTo(6);
        assertThat(o.period().label()).isEqualTo("2026年6月");
    }

    /** 空表边界：MySQL 的 MAX() 在空表上返回一行 NULL(不是空结果集)，5 源全空必须回退到兜底期而不是 NPE。 */
    @Test
    void period_allTablesEmpty_aggregateReturnsNullRow_fallsBackTo200001() {
        stubAllEmpty();
        List<Object> nullRow = java.util.Collections.singletonList(null);
        when(ledger.<Object>selectObjs(any())).thenReturn(nullRow);
        when(s10.<Object>selectObjs(any())).thenReturn(nullRow);
        when(salary.<Object>selectObjs(any())).thenReturn(nullRow);
        when(office.<Object>selectObjs(any())).thenReturn(nullRow);

        DataHomeOverviewDTO o = svc.overview();
        assertThat(o.period().year()).isEqualTo(2000);
        assertThat(o.period().month()).isEqualTo(1);
        assertThat(o.progressDone()).isZero();
    }

    @Test
    void source_doneVsMissing_andUpdatedFormat() {
        stubAllEmpty();
        // 本期由 salary 2026-06 决定
        when(salary.<Object>selectObjs(any())).thenReturn(List.of("2026-06"));
        when(salary.selectByMonth("2026-06")).thenReturn(List.of(salaryRow("2026-06", LocalDateTime.of(2026, 6, 5, 8, 30))));

        DataHomeOverviewDTO o = svc.overview();
        DataHomeSourceDTO salarySrc = o.sources().stream()
            .filter(s -> s.name().equals("工资明细")).findFirst().orElseThrow();
        assertThat(salarySrc.status()).isEqualTo("done");
        assertThat(salarySrc.updated()).isEqualTo("6/5");

        DataHomeSourceDTO ledgerSrc = o.sources().stream()
            .filter(s -> s.name().equals("月度台账")).findFirst().orElseThrow();
        assertThat(ledgerSrc.status()).isEqualTo("missing");
        assertThat(ledgerSrc.updated()).isEqualTo("—");

        assertThat(o.sources()).hasSize(9);
        assertThat(o.progressTotal()).isEqualTo(9);
        assertThat(o.progressDone()).isEqualTo(1);
        assertThat(o.pct()).isEqualTo(11); // round(1/9*100)=11
    }

    @Test
    void missingSources_generateWarningTasks() {
        stubAllEmpty();
        when(salary.<Object>selectObjs(any())).thenReturn(List.of("2026-06"));
        when(salary.selectByMonth("2026-06")).thenReturn(List.of(salaryRow("2026-06", LocalDateTime.of(2026, 6, 5, 8, 30))));

        DataHomeOverviewDTO o = svc.overview();
        // 8 个 missing 源 → 8 条待办；salary done 无待办；无合同到期
        assertThat(o.tasks()).hasSize(8);
        assertThat(o.tasks()).allMatch(t -> t.sev().equals("warning"));
        assertThat(o.tasks()).anyMatch(t -> t.label().equals("月度台账 本期未录入")
            && t.go().equals("ledger") && t.meta().equals("本期 2026年6月 暂无数据"));
    }

    @Test
    void contractExpiring_addsTask() {
        stubAllEmpty();
        when(salary.<Object>selectObjs(any())).thenReturn(List.of("2026-06"));
        when(salary.selectByMonth("2026-06")).thenReturn(List.of(salaryRow("2026-06", LocalDateTime.of(2026, 6, 5, 8, 30))));
        when(contractService.summary()).thenReturn(summary(3));

        DataHomeOverviewDTO o = svc.overview();
        assertThat(o.tasks()).anyMatch(t -> t.label().equals("3 份合同即将到期待续签")
            && t.go().equals("contracts") && t.sev().equals("warning"));
        // 8 missing + 1 合同 = 9
        assertThat(o.tasks()).hasSize(9);
    }

    @Test
    void recent_top6_orderedByUpdatedDesc() {
        stubAllEmpty();
        // 本期 2026-06；造 7 条不同时间的本期行，应取最新 6 条降序
        when(salary.<Object>selectObjs(any())).thenReturn(List.of("2026-06"));
        when(salary.selectByMonth("2026-06")).thenReturn(List.of(
            salaryRow("2026-06", LocalDateTime.of(2026, 6, 1, 10, 0)),
            salaryRow("2026-06", LocalDateTime.of(2026, 6, 7, 10, 0))));
        when(s10.selectBySlot(1, "2026-06")).thenReturn(List.of(
            s10Row("2026-06", 1, LocalDateTime.of(2026, 6, 2, 10, 0)),
            s10Row("2026-06", 1, LocalDateTime.of(2026, 6, 6, 10, 0))));
        when(pv.selectByYear(2026)).thenReturn(List.of(
            pvRow("2026-03", LocalDateTime.of(2026, 6, 3, 10, 0)),
            pvRow("2026-04", LocalDateTime.of(2026, 6, 5, 10, 0)),
            pvRow("2026-05", LocalDateTime.of(2026, 6, 4, 10, 0))));

        DataHomeOverviewDTO o = svc.overview();
        assertThat(o.recent()).hasSize(6);
        // 最新一条 = 6/7 10:00 工资
        assertThat(o.recent().get(0).source()).isEqualTo("工资明细");
        assertThat(o.recent().get(0).time()).isEqualTo("6/7 10:00");
        // 降序：时间字符串对应 7,6,5,4,3,2 日
        List<String> times = o.recent().stream().map(DataHomeRecentDTO::time).toList();
        assertThat(times).containsExactly(
            "6/7 10:00", "6/6 10:00", "6/5 10:00", "6/4 10:00", "6/3 10:00", "6/2 10:00");
        // 年度源 period 用 'YYYY年M月'，月度源用 acct_month
        DataHomeRecentDTO pvRecent = o.recent().stream()
            .filter(r -> r.source().equals("光伏发电")).findFirst().orElseThrow();
        assertThat(pvRecent.period()).isEqualTo("2026年6月");
    }

    @Test
    void kpis_deriveCountsAndMaxUpdate() {
        stubAllEmpty();
        when(salary.<Object>selectObjs(any())).thenReturn(List.of("2026-06"));
        when(salary.selectByMonth("2026-06")).thenReturn(List.of(
            salaryRow("2026-06", LocalDateTime.of(2026, 6, 5, 9, 12)),
            salaryRow("2026-06", LocalDateTime.of(2026, 6, 5, 9, 13))));
        when(pv.selectByYear(2026)).thenReturn(List.of(pvRow("2026-06", LocalDateTime.of(2026, 6, 6, 11, 59))));

        DataHomeOverviewDTO o = svc.overview();
        // 2 source done(salary, pv) → pct round(2/9*100)=22
        DataHomeKpiDTO k1 = o.kpis().get(0);
        assertThat(k1.label()).isEqualTo("数据完整度");
        assertThat(k1.value()).isEqualTo("22%");
        assertThat(k1.sub()).isEqualTo("2 / 9 项");
        // 本期记录数 = 2(salary) + 1(pv) = 3
        DataHomeKpiDTO k3 = o.kpis().get(2);
        assertThat(k3.label()).isEqualTo("本期记录数");
        assertThat(k3.value()).isEqualTo("3");
        // 最近更新 = max(updated_at) = 6/6 11:59 光伏发电
        DataHomeKpiDTO k4 = o.kpis().get(3);
        assertThat(k4.label()).isEqualTo("最近更新");
        assertThat(k4.value()).isEqualTo("11:59");
        assertThat(k4.sub()).isEqualTo("6/6 · 光伏发电");
        // 待处理事项 = tasks.length
        DataHomeKpiDTO k2 = o.kpis().get(1);
        assertThat(k2.label()).isEqualTo("待处理事项");
        assertThat(k2.value()).isEqualTo(String.valueOf(o.tasks().size()));
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
}
