package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.PvOverviewDTO;
import com.park.demo3.dto.PvRecordDTO;
import com.park.demo3.dto.PvYearDTO;
import com.park.demo3.entity.PvPhase;
import com.park.demo3.entity.PvRecord;
import com.park.demo3.mapper.PvPhaseMapper;
import com.park.demo3.mapper.PvRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PvServiceTest {
    PvPhaseMapper phases = Mockito.mock(PvPhaseMapper.class);
    PvRecordMapper records = Mockito.mock(PvRecordMapper.class);
    PvService svc = new PvService(phases, records);

    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }

    PvPhase phase(String id, String name, int sort) {
        PvPhase p = new PvPhase();
        p.setId(id); p.setName(name); p.setShortName(name); p.setSortNo(sort);
        return p;
    }
    PvRecord rec(int id, String phaseId, String acct,
                 double sk, double sa, double gk, double ga, String source) {
        PvRecord r = new PvRecord();
        r.setId(id); r.setPhaseId(phaseId); r.setAcctMonth(acct); r.setOccurMonth(acct);
        r.setSelfKwh(bd(sk)); r.setSelfAmt(bd(sa)); r.setGridKwh(bd(gk)); r.setGridAmt(bd(ga));
        r.setSource(source);
        return r;
    }
    List<PvPhase> threePhases() {
        return List.of(phase("p1", "一期", 1), phase("p2", "二期", 2), phase("p3", "三期", 3));
    }

    @Test void recordsYear_derivesGenFeePerRow_andPhaseSubtotals() {
        Mockito.when(phases.selectAllSorted()).thenReturn(threePhases());
        // 2025: p1 two rows, p2 one row
        Mockito.when(records.selectByYear(2025)).thenReturn(List.of(
            rec(1, "p1", "2025-01", 100.00, 90.00, 40.00, 18.00, "seed"),
            rec(2, "p1", "2025-02", 200.00, 180.00, 50.00, 22.50, "seed"),
            rec(3, "p2", "2025-06", 300.00, 270.00, 60.00, 27.00, "seed")));

        PvYearDTO y = svc.records(2025);
        assertThat(y.year()).isEqualTo(2025);
        assertThat(y.phases()).hasSize(3);
        assertThat(y.rows()).hasSize(3);

        // gen = selfKwh + gridKwh, fee = selfAmt + gridAmt (derived, per row)
        PvRecordDTO r1 = y.rows().get(0);
        assertThat(r1.gen()).isEqualByComparingTo("140.00"); // 100 + 40
        assertThat(r1.fee()).isEqualByComparingTo("108.00"); // 90 + 18
        assertThat(r1.phaseName()).isEqualTo("一期");

        // year total = sum across all rows
        PvYearDTO.PvTotal t = y.total();
        assertThat(t.gen()).isEqualByComparingTo("750.00");     // (140)+(250)+(360)
        assertThat(t.fee()).isEqualByComparingTo("607.50");     // 108+202.5+297
        assertThat(t.selfKwh()).isEqualByComparingTo("600.00");
        assertThat(t.gridKwh()).isEqualByComparingTo("150.00");
        assertThat(t.selfAmt()).isEqualByComparingTo("540.00");
        assertThat(t.gridAmt()).isEqualByComparingTo("67.50");
    }

    @Test void overview_yearRangeBaseToMaxPlusOne_currentYearIsMaxData() {
        // data spans 2024..2026 → range [2024..2027], currentYear = 2026
        Mockito.when(records.selectList(null)).thenReturn(List.of(
            rec(1, "p1", "2024-09", 100, 90, 0, 0, "seed"),
            rec(2, "p1", "2025-01", 200, 180, 0, 0, "seed"),
            rec(3, "p1", "2026-01", 300, 270, 0, 0, "seed")));

        PvOverviewDTO ov = svc.overview();
        assertThat(ov.currentYear()).isEqualTo(2026);
        assertThat(ov.years()).extracting(PvOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025, 2026, 2027);
        // 2024 hasData, count 1, fee 90
        PvOverviewDTO.YearMeta y24 = ov.years().get(0);
        assertThat(y24.hasData()).isTrue();
        assertThat(y24.count()).isEqualTo(1);
        assertThat(y24.totalFee()).isEqualByComparingTo("90.00");
        // 2027 empty
        PvOverviewDTO.YearMeta y27 = ov.years().get(3);
        assertThat(y27.hasData()).isFalse();
        assertThat(y27.count()).isEqualTo(0);
        assertThat(y27.totalFee()).isEqualByComparingTo("0.00");
    }

    @Test void delete_seedRow_nowDeletable() {
        Mockito.when(records.selectById(7)).thenReturn(rec(7, "p1", "2025-01", 1, 1, 0, 0, "seed"));
        svc.delete(7);
        Mockito.verify(records).deleteById(7);
    }

    @Test void delete_missingRow_404() {
        Mockito.when(records.selectById(99)).thenReturn(null);
        assertThatThrownBy(() -> svc.delete(99)).isInstanceOf(BizException.class);
    }

    @Test void delete_manualRow_ok() {
        Mockito.when(records.selectById(8)).thenReturn(rec(8, "p1", "2025-01", 1, 1, 0, 0, "manual"));
        svc.delete(8);
        Mockito.verify(records).deleteById(8);
    }
}
