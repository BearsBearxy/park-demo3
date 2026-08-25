package com.park.demo3.service;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.TenantMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// 结余链写时归一(2026-08-24 拍板,2026-08-25 修订为**严格相邻**):
// 上一自然月有记录 → balance_prev 强制=该月期末;上一自然月无记录 → 本月是链起点,存量期初原样保留
// (早期「跨空洞前滚到上一有据月」会把补录历史月之后所有月的期初改坏);绑定/改名换键后按新键重挂。
class LedgerRechainTest {
    MonthlyLedgerMapper lm = Mockito.mock(MonthlyLedgerMapper.class);
    ManagementCompanyMapper cm = Mockito.mock(ManagementCompanyMapper.class);
    TenantMapper tm = Mockito.mock(TenantMapper.class);
    BookService bm = Mockito.mock(BookService.class);
    LedgerService svc = new LedgerService(lm, cm, tm, bm);

    static BigDecimal bd(String v) { return new BigDecimal(v); }

    MonthlyLedger row(int id, Integer tenantId, String name, int y, int m,
                      String prev, String rent, String collected) {
        MonthlyLedger l = new MonthlyLedger();
        l.setId(id); l.setCompanyId(1); l.setTenantId(tenantId); l.setTenantName(name);
        l.setPeriodYear(y); l.setPeriodMonth(m);
        l.setBalancePrev(bd(prev)); l.setFactoryRent(bd(rent)); l.setTotalCollected(bd(collected));
        return l;
    }

    @Test
    void chain_derivesOnlyFromAdjacentMonth_gapStartsNewChain() {
        // 严格相邻(2026-08-25):1月有账、2月空洞、3月的 balance_prev 不得接 1月期末——
        // 3月的「上月」是 2月,2月没账 → 3月是链起点,存量 999 原样保留(人工期初/导入期初)
        MonthlyLedger jan = row(1, 10, "甲", 2025, 1, "100", "1000", "800");
        MonthlyLedger mar = row(2, 10, "甲", 2025, 3, "999", "500", "0");
        MonthlyLedger first = row(3, 11, "乙", 2025, 3, "77", "10", "0");   // 仅 3月出现
        Mockito.when(lm.selectList(Mockito.any())).thenReturn(List.of(jan, mar, first));

        svc.rechain(1);

        Mockito.verify(lm, Mockito.never()).updateById(Mockito.any(MonthlyLedger.class));
        assertThat(jan.getBalancePrev()).isEqualByComparingTo("100");
        assertThat(mar.getBalancePrev()).isEqualByComparingTo("999");   // 跨空洞不接
        assertThat(first.getBalancePrev()).isEqualByComparingTo("77");
    }

    @Test
    void chain_adjacentMonths_forcePrevFromLastEnd_acrossYearBoundary() {
        // 相邻即派生,跨年也算相邻(2024-12 → 2025-01)
        MonthlyLedger dec = row(1, 10, "甲", 2024, 12, "0", "1000", "400");   // 末=600
        MonthlyLedger jan = row(2, 10, "甲", 2025, 1, "888", "0", "0");       // 库里错值 → 应改 600
        Mockito.when(lm.selectList(Mockito.any())).thenReturn(List.of(dec, jan));

        svc.rechain(1);

        ArgumentCaptor<MonthlyLedger> cap = ArgumentCaptor.forClass(MonthlyLedger.class);
        Mockito.verify(lm, Mockito.times(1)).updateById(cap.capture());
        assertThat(cap.getValue().getId()).isEqualTo(2);
        assertThat(jan.getBalancePrev()).isEqualByComparingTo("600");
    }

    @Test
    void chain_softNameKey_untilBound_thenIdKey() {
        // 未绑定行按账面名成链:1月「丙」末=50;2月「丙」prev 应=50(库里 0 → 改)
        MonthlyLedger jan = row(1, null, "丙", 2025, 1, "0", "50", "0");
        MonthlyLedger feb = row(2, null, "丙", 2025, 2, "0", "0", "0");
        Mockito.when(lm.selectList(Mockito.any())).thenReturn(List.of(jan, feb));

        svc.rechain(1);

        assertThat(feb.getBalancePrev()).isEqualByComparingTo("50");
        Mockito.verify(lm, Mockito.times(1)).updateById(Mockito.any(MonthlyLedger.class));
    }

    @Test
    void chain_scaleOnlyDifference_alignsInMemory_noDbWrite() {
        MonthlyLedger jan = row(1, 10, "甲", 2025, 1, "0", "100", "0");     // 末=100
        MonthlyLedger feb = row(2, 10, "甲", 2025, 2, "100.0", "0", "0");   // 数值等,仅 scale 差
        Mockito.when(lm.selectList(Mockito.any())).thenReturn(List.of(jan, feb));

        svc.rechain(1);

        Mockito.verify(lm, Mockito.never()).updateById(Mockito.any(MonthlyLedger.class));
        assertThat(feb.getBalancePrev()).isEqualByComparingTo("100");
    }
}
