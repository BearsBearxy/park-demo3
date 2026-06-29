package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.ChargingOverviewDTO;
import com.park.demo3.dto.ChargingRecordDTO;
import com.park.demo3.dto.ChargingYearDTO;
import com.park.demo3.entity.ChargingCat;
import com.park.demo3.entity.ChargingRecord;
import com.park.demo3.mapper.ChargingCatMapper;
import com.park.demo3.mapper.ChargingRecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ChargingServiceTest {
    ChargingCatMapper cats = Mockito.mock(ChargingCatMapper.class);
    ChargingRecordMapper records = Mockito.mock(ChargingRecordMapper.class);
    ChargingService svc = new ChargingService(cats, records);

    static BigDecimal bd(double v) { return BigDecimal.valueOf(v); }

    ChargingCat cat(String id, String name, int sort) {
        ChargingCat c = new ChargingCat();
        c.setScheduleNo(7); c.setCatId(id); c.setName(name); c.setShortName(name);
        c.setTint("slate"); c.setSortNo(sort);
        return c;
    }
    ChargingRecord rec(int id, String cat, String acct,
                       double kwh, double fee, double cost, String source) {
        ChargingRecord r = new ChargingRecord();
        r.setId(id); r.setScheduleNo(7); r.setCat(cat); r.setAcctMonth(acct);
        r.setKwh(bd(kwh)); r.setFee(bd(fee)); r.setCost(bd(cost)); r.setSource(source);
        return r;
    }
    List<ChargingCat> twoCats() {
        return List.of(cat("dc", "直流快充桩", 1), cat("ac", "交流慢充桩", 2));
    }

    @Test void recordsYear_derivesProfitPerRow_andYearTotals() {
        Mockito.when(cats.selectBySchedule(7)).thenReturn(twoCats());
        Mockito.when(records.selectByScheduleAndYear(7, 2025)).thenReturn(List.of(
            rec(1, "dc", "2025-01", 36120.00, 31063.20, 22394.40, "seed"),
            rec(2, "dc", "2025-02", 35280.00, 30340.80, 21873.60, "seed"),
            rec(3, "ac", "2025-01", 11610.00, 8591.40, 6966.00, "seed")));

        ChargingYearDTO y = svc.records(7, 2025);
        assertThat(y.year()).isEqualTo(2025);
        assertThat(y.cats()).hasSize(2);
        assertThat(y.rows()).hasSize(3);

        // profit = fee - cost, derived per row
        ChargingRecordDTO r1 = y.rows().get(0);
        assertThat(r1.profit()).isEqualByComparingTo("8668.80"); // 31063.20 - 22394.40
        assertThat(r1.catName()).isEqualTo("直流快充桩");

        // year totals = sum across all rows
        ChargingYearDTO.ChargingTotal t = y.total();
        assertThat(t.kwh()).isEqualByComparingTo("83010.00");   // 36120 + 35280 + 11610
        assertThat(t.fee()).isEqualByComparingTo("69995.40");   // 31063.20 + 30340.80 + 8591.40
        assertThat(t.cost()).isEqualByComparingTo("51234.00");  // 22394.40 + 21873.60 + 6966.00
        assertThat(t.profit()).isEqualByComparingTo("18761.40"); // fee - cost
    }

    @Test void overview_yearRangeBaseToMaxPlusOne_currentYearIsMaxData() {
        // data spans 2025..2026 → range [2024..2027], currentYear = 2026
        Mockito.when(records.selectBySchedule(7)).thenReturn(List.of(
            rec(1, "dc", "2025-01", 100, 90, 30, "seed"),
            rec(2, "dc", "2026-01", 200, 180, 60, "seed")));

        ChargingOverviewDTO ov = svc.overview(7);
        assertThat(ov.currentYear()).isEqualTo(2026);
        assertThat(ov.years()).extracting(ChargingOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025, 2026, 2027);
        // 2024 empty
        ChargingOverviewDTO.YearMeta y24 = ov.years().get(0);
        assertThat(y24.hasData()).isFalse();
        assertThat(y24.count()).isEqualTo(0);
        assertThat(y24.totalProfit()).isEqualByComparingTo("0.00");
        // 2025 hasData, count 1, profit = 90 - 30 = 60
        ChargingOverviewDTO.YearMeta y25 = ov.years().get(1);
        assertThat(y25.hasData()).isTrue();
        assertThat(y25.count()).isEqualTo(1);
        assertThat(y25.totalProfit()).isEqualByComparingTo("60.00");
        // 2027 empty (upper bound)
        ChargingOverviewDTO.YearMeta y27 = ov.years().get(3);
        assertThat(y27.hasData()).isFalse();
        assertThat(y27.count()).isEqualTo(0);
    }

    @Test void overview_noData_rangeBaseToBasePlusOne_currentYearBaseMinusNothing() {
        // no data → range [2024..2025], currentYear = 2024
        Mockito.when(records.selectBySchedule(8)).thenReturn(List.of());
        ChargingOverviewDTO ov = svc.overview(8);
        assertThat(ov.currentYear()).isEqualTo(2024);
        assertThat(ov.years()).extracting(ChargingOverviewDTO.YearMeta::year)
            .containsExactly(2024, 2025);
    }

    @Test void delete_seedRow_conflicts() {
        Mockito.when(records.selectById(7)).thenReturn(rec(7, "dc", "2025-01", 1, 1, 0, "seed"));
        assertThatThrownBy(() -> svc.delete(7, 7)).isInstanceOf(BizException.class);
        Mockito.verify(records, Mockito.never()).deleteById(Mockito.anyInt());
    }

    @Test void delete_manualRow_ok() {
        Mockito.when(records.selectById(8)).thenReturn(rec(8, "dc", "2025-01", 1, 1, 0, "manual"));
        svc.delete(7, 8);
        Mockito.verify(records).deleteById(8);
    }
}
