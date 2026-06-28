package com.park.demo3.service;
import com.park.demo3.dto.LedgerMonthDTO;
import com.park.demo3.dto.LedgerMonthDTO.LedgerRowDTO;
import com.park.demo3.dto.LedgerOverviewDTO;
import com.park.demo3.dto.LedgerSaveRequest;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.TenantMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class LedgerServiceTest {
    MonthlyLedgerMapper lm = Mockito.mock(MonthlyLedgerMapper.class);
    ManagementCompanyMapper cm = Mockito.mock(ManagementCompanyMapper.class);
    TenantMapper tm = Mockito.mock(TenantMapper.class);
    LedgerService svc = new LedgerService(lm, cm, tm);

    // --- fixtures ---
    Tenant tenant(int id, int status) {
        Tenant t = new Tenant(); t.setId(id); t.setCompanyName("T" + id); t.setStatus(status); return t;
    }
    // 13 active tenants (1..13) + one retired (14, status=0)
    List<Tenant> allTenants() {
        List<Tenant> l = new ArrayList<>();
        for (int i = 1; i <= 13; i++) l.add(tenant(i, 1));
        l.add(tenant(14, 0));
        return l;
    }
    ManagementCompany company(int id) {
        ManagementCompany c = new ManagementCompany(); c.setId(id); c.setName("园区租赁管理公司"); return c;
    }
    MonthlyLedger row(int companyId, int tenantId, int year, int month,
                      BigDecimal factoryRent, BigDecimal balancePrev, BigDecimal totalCollected) {
        MonthlyLedger l = new MonthlyLedger();
        l.setCompanyId(companyId); l.setTenantId(tenantId);
        l.setPeriodYear(year); l.setPeriodMonth(month);
        l.setFactoryRent(factoryRent);
        l.setBalancePrev(balancePrev); l.setTotalCollected(totalCollected);
        return l;
    }

    @Test void recalc_totalReceivableSumsFees_balanceEndAddsPrevSubtractsCollected() {
        // factoryRent 100000, balancePrev 2000, collected 80000 → recv 100000, end 22000
        MonthlyLedger l = row(1, 1, 2026, 5, bd(100000), bd(2000), bd(80000));
        BigDecimal[] d = LedgerService.recalc(l);
        assertThat(d[0]).isEqualByComparingTo("100000.00"); // totalReceivable
        assertThat(d[1]).isEqualByComparingTo("22000.00");  // balanceEnd
    }

    @Test void recalc_nullFeesTreatedAsZero() {
        MonthlyLedger l = new MonthlyLedger(); // all null
        BigDecimal[] d = LedgerService.recalc(l);
        assertThat(d[0]).isEqualByComparingTo("0.00");
        assertThat(d[1]).isEqualByComparingTo("0.00");
    }

    @Test void month_padsSparseStoredRowsTo13ActiveTenants() {
        Mockito.when(cm.selectById(1)).thenReturn(company(1));
        Mockito.when(tm.selectList(null)).thenReturn(allTenants());
        // only 2 stored rows; rest must be zero-padded; retired tenant 14 excluded
        Mockito.when(lm.selectMonth(1, 2026, 5)).thenReturn(List.of(
            row(1, 1, 2026, 5, bd(130560), bd(0), bd(130560)),
            row(1, 3, 2026, 5, bd(50000), bd(1000), bd(40000))));

        LedgerMonthDTO m = svc.month(1, 2026, 5);
        assertThat(m.rows()).hasSize(13);                       // padded to all active
        assertThat(m.prevMonth()).isEqualTo(4);
        assertThat(m.rows()).noneMatch(r -> r.tenantId() == 14); // retired excluded

        LedgerRowDTO r1 = byTenant(m, 1);
        assertThat(r1.totalReceivable()).isEqualByComparingTo("130560.00");
        assertThat(r1.balanceEnd()).isEqualByComparingTo("0.00");
        LedgerRowDTO r2 = byTenant(m, 2); // not stored → all zero
        assertThat(r2.totalReceivable()).isEqualByComparingTo("0.00");
        assertThat(r2.balanceEnd()).isEqualByComparingTo("0.00");
        assertThat(r2.note()).isNull();
        LedgerRowDTO r3 = byTenant(m, 3);
        assertThat(r3.balanceEnd()).isEqualByComparingTo("11000.00"); // 1000+50000-40000
        // footer column total for factoryRent = 130560 + 50000
        assertThat(m.footer().factoryRent()).isEqualByComparingTo("180560.00");
        assertThat(m.footer().totalReceivable()).isEqualByComparingTo("180560.00");
    }

    @Test void save_insertsNewUpdatesExistingDeletesBlankSkipsInactive() {
        Mockito.when(cm.selectById(1)).thenReturn(company(1));
        Mockito.when(tm.selectList(null)).thenReturn(allTenants());
        MonthlyLedger existing1 = row(1, 1, 2026, 5, bd(100000), bd(0), bd(100000));
        existing1.setId(501);
        MonthlyLedger existing2 = row(1, 2, 2026, 5, bd(90000), bd(0), bd(90000));
        existing2.setId(502);
        // selectMonth called once inside save (snapshot) and again at the end via month()
        Mockito.when(lm.selectMonth(1, 2026, 5)).thenReturn(List.of(existing1, existing2));

        LedgerSaveRequest req = new LedgerSaveRequest(List.of(
            saveRow(1, bd(120000), bd(120000)),   // update existing tenant 1
            saveRow(3, bd(70000),  bd(70000)),    // insert new tenant 3
            blankRow(2),                          // blank existing tenant 2 → delete
            saveRow(14, bd(5000),  bd(5000))));   // inactive → skipped

        svc.save(1, 2026, 5, req);

        Mockito.verify(lm).updateById(ArgumentMatchers.<MonthlyLedger>argThat(l -> l.getTenantId() == 1
            && l.getFactoryRent().compareTo(bd(120000)) == 0));
        Mockito.verify(lm).insert(ArgumentMatchers.<MonthlyLedger>argThat(l -> l.getTenantId() == 3));
        Mockito.verify(lm).deleteById(502);
        // inactive tenant 14 never inserted/updated
        Mockito.verify(lm, Mockito.never()).insert(ArgumentMatchers.<MonthlyLedger>argThat(l -> l.getTenantId() == 14));
    }

    @Test void copyFromPrev_carriesFeesAndRollsBalanceEndIntoBalancePrev_resetsCollectedAndNote() {
        Mockito.when(cm.selectById(1)).thenReturn(company(1));
        Mockito.when(tm.selectList(null)).thenReturn(allTenants());
        // prev month (4) has one row: recv 100000, prev 5000, collected 60000 → end 45000
        MonthlyLedger prev = row(1, 1, 2026, 4, bd(100000), bd(5000), bd(60000));
        prev.setId(401); prev.setNote("旧备注");
        Mockito.when(lm.selectMonth(1, 2026, 4)).thenReturn(List.of(prev));
        Mockito.when(lm.selectMonth(1, 2026, 5)).thenReturn(List.of()); // target empty → insert
        Mockito.when(tm.selectList(null)).thenReturn(allTenants());

        svc.copyFromPrev(1, 2026, 5);

        Mockito.verify(lm).insert(ArgumentMatchers.<MonthlyLedger>argThat(l ->
            l.getTenantId() == 1
            && l.getFactoryRent().compareTo(bd(100000)) == 0      // fees copied
            && l.getBalancePrev().compareTo(bd(45000)) == 0       // prev balanceEnd carried in
            && l.getTotalCollected().compareTo(BigDecimal.ZERO) == 0
            && l.getNote() == null));                              // note reset
    }

    @Test void overview_currentMonthIsMaxMonthWithData_ytdAndAvgFromRecv() {
        Mockito.when(cm.selectById(1)).thenReturn(company(1));
        Mockito.when(tm.selectList(null)).thenReturn(allTenants());
        // months 1 and 2 have data: recv 100000 and 200000
        Mockito.when(lm.selectYear(1, 2026)).thenReturn(List.of(
            row(1, 1, 2026, 1, bd(100000), bd(0), bd(100000)),
            row(1, 1, 2026, 2, bd(200000), bd(0), bd(200000))));

        LedgerOverviewDTO ov = svc.overview(1, 2026);
        assertThat(ov.months()).hasSize(12);
        assertThat(ov.monthsWithData()).isEqualTo(2);
        assertThat(ov.activeTenants()).isEqualTo(13);
        assertThat(ov.ytdRecv()).isEqualByComparingTo("300000.00");
        assertThat(ov.avgRecv()).isEqualByComparingTo("150000.00");
        assertThat(meta(ov, 1).status()).isEqualTo("done");
        assertThat(meta(ov, 2).status()).isEqualTo("current"); // max month with data
        assertThat(meta(ov, 3).status()).isEqualTo("empty");
    }

    // --- helpers ---
    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }
    static LedgerRowDTO byTenant(LedgerMonthDTO m, int tid) {
        return m.rows().stream().filter(r -> r.tenantId() == tid).findFirst().orElseThrow();
    }
    static LedgerOverviewDTO.MonthMeta meta(LedgerOverviewDTO ov, int month) {
        return ov.months().stream().filter(x -> x.month() == month).findFirst().orElseThrow();
    }
    // Row with only factoryRent set (other 20 fees null → zero)
    LedgerSaveRequest.Row saveRow(int tenantId, BigDecimal factoryRent, BigDecimal collected) {
        return new LedgerSaveRequest.Row(tenantId, BigDecimal.ZERO,
            factoryRent, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null,
            null, null, null, null, null,
            collected, null);
    }
    LedgerSaveRequest.Row blankRow(int tenantId) {
        return new LedgerSaveRequest.Row(tenantId, null,
            null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null,
            null, null, null, null, null,
            null, null);
    }
}
