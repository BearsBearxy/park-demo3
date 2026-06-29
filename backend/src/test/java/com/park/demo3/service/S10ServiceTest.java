package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.S10MonthDTO;
import com.park.demo3.dto.S10OverviewDTO;
import com.park.demo3.dto.S10RecordDTO;
import com.park.demo3.dto.S10RecordReq;
import com.park.demo3.entity.S10Record;
import com.park.demo3.mapper.S10RecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class S10ServiceTest {
    S10RecordMapper records = Mockito.mock(S10RecordMapper.class);
    S10Service svc = new S10Service(records);

    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }

    // 最小行:officeRent / factoryRent / elecStd 三列有值,其余 0 → rowTotal = 三者和
    S10Record rec(long id, Integer tenantId, String name, int phase, String acct, String source,
                  double officeRent, double factoryRent, double elecStd) {
        S10Record r = new S10Record();
        r.setId(id); r.setTenantId(tenantId); r.setTenantName(name);
        r.setPhase(phase); r.setAcctMonth(acct); r.setProfile("factory"); r.setSource(source);
        r.setOfficeRent(bd(officeRent)); r.setFactoryRent(bd(factoryRent)); r.setElecStd(bd(elecStd));
        return r;
    }

    // ── month:稀疏读 + 派生 total + 列合计 + 总计 ──
    @Test void month_sparseRows_derivesRowTotalAndColumnTotals() {
        Mockito.when(records.selectBySlot(2, "2025-03")).thenReturn(List.of(
            rec(1L, 3, "康泽生物", 2, "2025-03", "seed", 0, 1000, 200),
            rec(2L, 4, "新元材料", 2, "2025-03", "seed", 0, 500, 100)));

        S10MonthDTO m = svc.month(2, 2025, 3);
        assertThat(m.phase()).isEqualTo(2);
        assertThat(m.year()).isEqualTo(2025);
        assertThat(m.month()).isEqualTo(3);
        assertThat(m.recorded()).isTrue();
        assertThat(m.rows()).hasSize(2);

        S10RecordDTO r1 = m.rows().get(0);
        assertThat(r1.total()).isEqualByComparingTo("1200.00");   // 1000 + 200
        // 列合计
        assertThat(m.columnTotals().get("factoryRent")).isEqualByComparingTo("1500.00");  // 1000 + 500
        assertThat(m.columnTotals().get("elecStd")).isEqualByComparingTo("300.00");       // 200 + 100
        assertThat(m.columnTotals().get("officeRent")).isEqualByComparingTo("0.00");
        // 总计 = 全表之和
        assertThat(m.grandTotal()).isEqualByComparingTo("1800.00");
    }

    @Test void month_noRows_emptyNotRecorded() {
        Mockito.when(records.selectBySlot(4, "2026-06")).thenReturn(List.of());
        S10MonthDTO m = svc.month(4, 2026, 6);
        assertThat(m.recorded()).isFalse();
        assertThat(m.rows()).isEmpty();
        assertThat(m.grandTotal()).isEqualByComparingTo("0.00");
        assertThat(m.columnTotals().get("factoryRent")).isEqualByComparingTo("0.00");
    }

    // ── overview:范围/currentYear/currentMonth/摘要派生 ──
    @Test void overview_deterministicRange_currentYearMonthAndSummaries() {
        // 数据跨 2024..2026;2026 最大月=6 → currentMonth=6,范围 [2024..2027],currentYear=2026
        Mockito.when(records.selectList(null)).thenReturn(List.of(
            rec(1L, 1, "中誉机械重工", 1, "2024-05", "seed", 0, 100, 0),
            rec(2L, 1, "中誉机械重工", 1, "2025-01", "seed", 0, 100, 0),
            rec(3L, 2, "锐通电子", 1, "2026-03", "seed", 0, 100, 0),
            rec(4L, 2, "锐通电子", 1, "2026-06", "seed", 0, 100, 0),
            rec(5L, 9, "晨辉食品", 1, "2026-06", "seed", 0, 100, 0)));

        S10OverviewDTO ov = svc.overview();
        assertThat(ov.years()).containsExactly(2024, 2025, 2026, 2027);
        assertThat(ov.currentYear()).isEqualTo(2026);
        assertThat(ov.currentMonth()).isEqualTo(6);

        // 2026 摘要:去重月 {3,6}=2;去重租户 {2,9}=2
        assertThat(ov.summaries().get(2).year()).isEqualTo(2026);
        assertThat(ov.summaries().get(2).recordedMonths()).isEqualTo(2);
        assertThat(ov.summaries().get(2).tenantCount()).isEqualTo(2);
        // 2027 空摘要
        assertThat(ov.summaries().get(3).recordedMonths()).isEqualTo(0);
        assertThat(ov.summaries().get(3).tenantCount()).isEqualTo(0);
    }

    @Test void overview_noData_baseRange() {
        Mockito.when(records.selectList(null)).thenReturn(List.of());
        S10OverviewDTO ov = svc.overview();
        assertThat(ov.years()).containsExactly(2024, 2025);
        assertThat(ov.currentYear()).isEqualTo(2024);
        assertThat(ov.currentMonth()).isEqualTo(0);
    }

    // ── save:新行 upsert(insert),既有 slot upsert(update) ──
    @Test void save_newSlot_insertsManual() {
        Mockito.when(records.selectBySlotTenant(1, "2026-06", "新户")).thenReturn(null);
        // mock insert 回填自增 id（模拟 MyBatis-Plus useGeneratedKeys），否则 save 末尾 selectById(null) → NPE
        Mockito.doAnswer(inv -> { inv.getArgument(0, S10Record.class).setId(10L); return 1; })
            .when(records).insert(Mockito.any(S10Record.class));
        Mockito.when(records.selectById(10L)).thenReturn(
            rec(10L, null, "新户", 1, "2026-06", "manual", 0, 800, 0));

        S10RecordReq req = reqWithFactoryRent(null, "新户", 1, "2026-06", 800);
        S10RecordDTO dto = svc.save(req);
        assertThat(dto.source()).isEqualTo("manual");
        assertThat(dto.total()).isEqualByComparingTo("800.00");
        Mockito.verify(records).insert(Mockito.any(S10Record.class));
        Mockito.verify(records, Mockito.never()).updateById(Mockito.any(S10Record.class));
    }

    @Test void save_existingSlot_updatesPreservingSeedSource() {
        S10Record existing = rec(20L, 3, "康泽生物", 2, "2025-03", "seed", 0, 100, 0);
        Mockito.when(records.selectBySlotTenant(2, "2025-03", "康泽生物")).thenReturn(existing);
        Mockito.when(records.selectById(20L)).thenReturn(existing);

        S10RecordReq req = reqWithFactoryRent(3, "康泽生物", 2, "2025-03", 999);
        svc.save(req);

        ArgumentCaptor<S10Record> cap = ArgumentCaptor.forClass(S10Record.class);
        Mockito.verify(records).updateById(cap.capture());
        assertThat(cap.getValue().getSource()).isEqualTo("seed");          // 既有 source 不被覆盖
        assertThat(cap.getValue().getFactoryRent()).isEqualByComparingTo("999.00");
        Mockito.verify(records, Mockito.never()).insert(Mockito.any(S10Record.class));
    }

    // ── delete seed → 409;manual → ok;不存在 → 404 ──
    @Test void delete_seedRow_conflicts() {
        Mockito.when(records.selectById(7L)).thenReturn(rec(7L, 1, "x", 1, "2025-01", "seed", 0, 1, 0));
        assertThatThrownBy(() -> svc.delete(7L)).isInstanceOf(BizException.class);
        Mockito.verify(records, Mockito.never()).deleteById(Mockito.anyLong());
    }

    @Test void delete_manualRow_ok() {
        Mockito.when(records.selectById(8L)).thenReturn(rec(8L, null, "x", 1, "2025-01", "manual", 0, 1, 0));
        svc.delete(8L);
        Mockito.verify(records).deleteById(8L);
    }

    @Test void delete_missing_notFound() {
        Mockito.when(records.selectById(99L)).thenReturn(null);
        assertThatThrownBy(() -> svc.delete(99L)).isInstanceOf(BizException.class);
    }

    @Test void updateNote_missing_notFound() {
        Mockito.when(records.selectById(99L)).thenReturn(null);
        assertThatThrownBy(() -> svc.updateNote(99L, "x")).isInstanceOf(BizException.class);
    }

    // factoryRent 单列填值的 req(其余 24 列 null)
    private static S10RecordReq reqWithFactoryRent(Integer tenantId, String name, int phase, String acct, double factoryRent) {
        return new S10RecordReq(tenantId, name, phase, acct, "factory", null,
            null, null, bd(factoryRent), null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null);
    }
}
