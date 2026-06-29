package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.ElecOverviewDTO;
import com.park.demo3.dto.ElecRecordDTO;
import com.park.demo3.dto.ElecYearDTO;
import com.park.demo3.entity.ElecPhase;
import com.park.demo3.entity.ElecRecord;
import com.park.demo3.mapper.ElecPhaseMapper;
import com.park.demo3.mapper.ElecRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ElecServiceTest {
    ElecPhaseMapper phases = Mockito.mock(ElecPhaseMapper.class);
    ElecRecordMapper records = Mockito.mock(ElecRecordMapper.class);
    ElecService svc = new ElecService(phases, records);

    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }

    ElecPhase phase(String id, String name, int sort) {
        ElecPhase p = new ElecPhase();
        p.setId(id); p.setName(name); p.setShortName(name); p.setSortNo(sort);
        return p;
    }
    ElecRecord energy(int id, String phaseId, String acct, double qty, double price, double rate, String source) {
        ElecRecord r = new ElecRecord();
        r.setId(id); r.setType("energy"); r.setPhaseId(phaseId); r.setAcctMonth(acct);
        r.setQty(bd(qty)); r.setPrice(bd(price)); r.setRate(bd(rate)); r.setSource(source);
        return r;
    }
    ElecRecord basic(int id, String phaseId, String acct, double demand, double price, double rate, String source) {
        ElecRecord r = new ElecRecord();
        r.setId(id); r.setType("basic"); r.setPhaseId(phaseId); r.setAcctMonth(acct);
        r.setDemand(bd(demand)); r.setPrice(bd(price)); r.setRate(bd(rate)); r.setSource(source);
        return r;
    }
    List<ElecPhase> threePhases() {
        return List.of(phase("p1", "一期", 1), phase("p2", "二期", 2), phase("p3", "三期", 3));
    }

    @Test void recordsYear_derivesAmountTaxTotalPerRow_andTotals_energy() {
        Mockito.when(phases.selectAllSorted()).thenReturn(threePhases());
        // energy: amount = qty×price, tax = amount×rate, total = amount+tax (all derived, 2dp HALF_UP)
        Mockito.when(records.selectByYearAndType(2025, "energy")).thenReturn(List.of(
            energy(1, "p1", "2025-01", 52550, 0.9821, 0.13, "seed"),
            energy(2, "p2", "2025-01", 41290, 0.9821, 0.13, "seed")));

        ElecYearDTO y = svc.records(2025, "energy");
        assertThat(y.year()).isEqualTo(2025);
        assertThat(y.type()).isEqualTo("energy");
        assertThat(y.phases()).hasSize(3);
        assertThat(y.rows()).hasSize(2);

        ElecRecordDTO r1 = y.rows().get(0);
        assertThat(r1.amount()).isEqualByComparingTo("51609.36"); // 52550 × 0.9821
        assertThat(r1.tax()).isEqualByComparingTo("6709.22");     // 51609.36 × 0.13
        assertThat(r1.total()).isEqualByComparingTo("58318.58");  // amount + tax
        assertThat(r1.phaseName()).isEqualTo("一期");

        ElecYearDTO.ElecTotal t = y.total();
        assertThat(t.qty()).isEqualByComparingTo("93840.00");     // 52550 + 41290
        // p2: 41290×0.9821 = 40551.13 (40551.1090 → 40551.11? check HALF_UP)
        ElecRecordDTO r2 = y.rows().get(1);
        assertThat(t.amount()).isEqualByComparingTo(r1.amount().add(r2.amount()));
        assertThat(t.tax()).isEqualByComparingTo(r1.tax().add(r2.tax()));
        assertThat(t.total()).isEqualByComparingTo(r1.total().add(r2.total()));
    }

    @Test void recordsYear_basic_derivesFromDemand() {
        Mockito.when(phases.selectAllSorted()).thenReturn(threePhases());
        // basic: amount = demand×price (qty null), tax/total derived
        Mockito.when(records.selectByYearAndType(2025, "basic")).thenReturn(List.of(
            basic(10, "p1", "2025-01", 1250, 32, 0.13, "seed")));

        ElecYearDTO y = svc.records(2025, "basic");
        ElecRecordDTO r = y.rows().get(0);
        assertThat(r.amount()).isEqualByComparingTo("40000.00"); // 1250 × 32
        assertThat(r.tax()).isEqualByComparingTo("5200.00");     // 40000 × 0.13
        assertThat(r.total()).isEqualByComparingTo("45200.00");
        assertThat(y.total().demand()).isEqualByComparingTo("1250.00");
        assertThat(y.total().amount()).isEqualByComparingTo("40000.00");
    }

    @Test void overview_yearRangeBaseToMaxPlusOne_currentYearIsMaxData() {
        // data spans 2024..2026 → range [2024..2027], currentYear = 2026; totalFee spans energy+basic
        Mockito.when(records.selectList(null)).thenReturn(List.of(
            energy(1, "p1", "2024-09", 1000, 1, 0.1, "seed"),   // amount 1000, tax 100, total 1100
            energy(2, "p1", "2025-01", 2000, 1, 0.1, "seed"),
            basic(3, "p1", "2026-01", 1250, 32, 0.13, "seed")));  // amount 40000, total 45200

        ElecOverviewDTO ov = svc.overview();
        assertThat(ov.currentYear()).isEqualTo(2026);
        assertThat(ov.years()).extracting(ElecOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025, 2026, 2027);

        ElecOverviewDTO.YearMeta y24 = ov.years().get(0);
        assertThat(y24.hasData()).isTrue();
        assertThat(y24.count()).isEqualTo(1);
        assertThat(y24.totalFee()).isEqualByComparingTo("1100.00");

        ElecOverviewDTO.YearMeta y26 = ov.years().get(2);
        assertThat(y26.totalFee()).isEqualByComparingTo("45200.00"); // basic price×tax

        ElecOverviewDTO.YearMeta y27 = ov.years().get(3);
        assertThat(y27.hasData()).isFalse();
        assertThat(y27.count()).isEqualTo(0);
        assertThat(y27.totalFee()).isEqualByComparingTo("0.00");
    }

    @Test void overview_noData_rangeBaseToBasePlusOne_currentIsUpperMinusOne() {
        Mockito.when(records.selectList(null)).thenReturn(List.of());
        ElecOverviewDTO ov = svc.overview();
        assertThat(ov.currentYear()).isEqualTo(2024);  // upper(2025) - 1
        assertThat(ov.years()).extracting(ElecOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025);
    }

    @Test void delete_seedRow_conflicts() {
        Mockito.when(records.selectById(7)).thenReturn(energy(7, "p1", "2025-01", 1, 1, 0.13, "seed"));
        assertThatThrownBy(() -> svc.delete(7)).isInstanceOf(BizException.class);
        Mockito.verify(records, Mockito.never()).deleteById(Mockito.anyInt());
    }

    @Test void delete_manualRow_ok() {
        Mockito.when(records.selectById(8)).thenReturn(energy(8, "p1", "2025-01", 1, 1, 0.13, "manual"));
        svc.delete(8);
        Mockito.verify(records).deleteById(8);
    }

    @Test void delete_missingRow_notFound() {
        Mockito.when(records.selectById(9)).thenReturn(null);
        assertThatThrownBy(() -> svc.delete(9)).isInstanceOf(BizException.class);
    }
}
