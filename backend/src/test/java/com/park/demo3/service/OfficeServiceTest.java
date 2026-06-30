package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.OfficeOverviewDTO;
import com.park.demo3.dto.OfficeRecordDTO;
import com.park.demo3.dto.OfficeYearDTO;
import com.park.demo3.entity.OfficeRecord;
import com.park.demo3.mapper.OfficeRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfficeServiceTest {
    OfficeRecordMapper records = Mockito.mock(OfficeRecordMapper.class);
    OfficeService svc = new OfficeService(records);

    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }

    OfficeRecord rec(int id, int no, String acct, String belong,
                     double eQty, double ePrice, double wQty, double wPrice, String source) {
        OfficeRecord r = new OfficeRecord();
        r.setId(id); r.setScheduleNo(no); r.setAcctMonth(acct); r.setBelongMonth(belong);
        r.setElecQty(bd(eQty)); r.setElecPrice(bd(ePrice));
        r.setWaterQty(bd(wQty)); r.setWaterPrice(bd(wPrice)); r.setSource(source);
        return r;
    }

    @Test void recordsYear_derivesAmountsPerRow_andYearTotals() {
        // office(13) 2025-01: elecAmt=3072×0.8123=2495.39, waterAmt=154×4.15=639.10, total=3134.49
        Mockito.when(records.selectByScheduleAndYear(13, 2025)).thenReturn(List.of(
            rec(1, 13, "2025-01", "2024-12", 3072.00, 0.8123, 154.00, 4.15, "seed"),
            rec(2, 13, "2025-02", "2025-01", 2880.00, 0.8123, 144.00, 4.15, "seed")));

        OfficeYearDTO y = svc.records(13, 2025);
        assertThat(y.year()).isEqualTo(2025);
        assertThat(y.scheduleNo()).isEqualTo(13);
        assertThat(y.rows()).hasSize(2);

        OfficeRecordDTO r1 = y.rows().get(0);
        assertThat(r1.elecAmt()).isEqualByComparingTo("2495.39");  // 3072 × 0.8123
        assertThat(r1.waterAmt()).isEqualByComparingTo("639.10");  // 154 × 4.15
        assertThat(r1.total()).isEqualByComparingTo("3134.49");    // sum

        // year totals across both rows
        OfficeYearDTO.OfficeTotal t = y.total();
        assertThat(t.elecQty()).isEqualByComparingTo("5952.00");   // 3072 + 2880
        assertThat(t.waterQty()).isEqualByComparingTo("298.00");   // 154 + 144
        // elecAmt: 2495.39 + 2880×0.8123=2339.42 → 4834.81
        assertThat(t.elecAmt()).isEqualByComparingTo("4834.81");
        // waterAmt: 639.10 + 144×4.15=597.60 → 1236.70
        assertThat(t.waterAmt()).isEqualByComparingTo("1236.70");
        assertThat(t.total()).isEqualByComparingTo("6071.51");     // 4834.81 + 1236.70
    }

    @Test void overview_mergesSchedulestoYearRange_includes2024FromPhase3() {
        // schedule 13 spans 2025..2026; schedule 14 spans 2024..2025.
        // merged → range [min(2024,2024)..max(2026)+1] = [2024..2027], currentYear = 2026.
        Mockito.when(records.selectBySchedule(13)).thenReturn(List.of(
            rec(1, 13, "2025-01", "2024-12", 3072.00, 0.8123, 154.00, 4.15, "seed"),
            rec(2, 13, "2026-01", "2025-12", 3072.00, 0.8123, 154.00, 4.15, "seed")));
        Mockito.when(records.selectBySchedule(14)).thenReturn(List.of(
            rec(3, 14, "2024-08", "2024-07", 18600.00, 0.7965, 1240.00, 3.85, "seed"),
            rec(4, 14, "2025-01", "2024-12", 14200.00, 0.7965, 760.00, 3.85, "seed")));

        OfficeOverviewDTO ov = svc.overview();
        assertThat(ov.currentYear()).isEqualTo(2026);
        assertThat(ov.years()).extracting(OfficeOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025, 2026, 2027);

        // 2024: only phase3 1 row; total = 18600×0.7965 + 1240×3.85 = 14814.90 + 4774.00 = 19588.90
        OfficeOverviewDTO.YearMeta y24 = ov.years().get(0);
        assertThat(y24.hasData()).isTrue();
        assertThat(y24.count()).isEqualTo(1);
        assertThat(y24.totalFee()).isEqualByComparingTo("19588.90");

        // 2025: office 1 + phase3 1 = 2 rows (merged)
        OfficeOverviewDTO.YearMeta y25 = ov.years().get(1);
        assertThat(y25.hasData()).isTrue();
        assertThat(y25.count()).isEqualTo(2);

        // 2027 empty (upper bound)
        OfficeOverviewDTO.YearMeta y27 = ov.years().get(3);
        assertThat(y27.hasData()).isFalse();
        assertThat(y27.count()).isEqualTo(0);
        assertThat(y27.totalFee()).isEqualByComparingTo("0.00");
    }

    @Test void overview_noData_rangeBaseToBasePlusOne() {
        Mockito.when(records.selectBySchedule(13)).thenReturn(List.of());
        Mockito.when(records.selectBySchedule(14)).thenReturn(List.of());
        OfficeOverviewDTO ov = svc.overview();
        assertThat(ov.currentYear()).isEqualTo(2024);
        assertThat(ov.years()).extracting(OfficeOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025);
    }

    // seed 不再锁删:种子行与手动行同等可删(WI-4 去保护)。
    @Test void delete_seedRow_succeeds() {
        Mockito.when(records.selectById(7)).thenReturn(
            rec(7, 13, "2025-01", "2024-12", 1, 1, 1, 1, "seed"));
        svc.delete(13, 7);
        Mockito.verify(records).deleteById(7);
    }

    @Test void delete_manualRow_ok() {
        Mockito.when(records.selectById(8)).thenReturn(
            rec(8, 13, "2025-01", "2024-12", 1, 1, 1, 1, "manual"));
        svc.delete(13, 8);
        Mockito.verify(records).deleteById(8);
    }

    @Test void delete_crossSchedule_notFound() {
        // record belongs to 14, deleting via path no=13 → 404 (no deletion)
        Mockito.when(records.selectById(9)).thenReturn(
            rec(9, 14, "2024-08", "2024-07", 1, 1, 1, 1, "manual"));
        assertThatThrownBy(() -> svc.delete(13, 9)).isInstanceOf(BizException.class);
        Mockito.verify(records, Mockito.never()).deleteById(Mockito.anyInt());
    }
}
