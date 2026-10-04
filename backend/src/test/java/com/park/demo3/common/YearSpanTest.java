package com.park.demo3.common;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 附表类屏年份范围(七个 service 共用)。2026-10-05 用户拍板「按你建议修改」:
 * 有数据时和改前逐字一样(2024 下界、最大数据年+1、当前=最大数据年);一条数据都没有才取今年。
 */
class YearSpanTest {
    @Test void withData_unchanged_floorStays2024() {
        assertThat(YearSpan.of(Set.of(2025, 2026))).isEqualTo(new YearSpan(2024, 2027, 2026));
        assertThat(YearSpan.of(Set.of(2026))).isEqualTo(new YearSpan(2024, 2027, 2026));   // 下界仍是 2024,不收窄
        assertThat(YearSpan.of(Set.of(2023, 2025))).isEqualTo(new YearSpan(2023, 2026, 2025));   // 早于 2024 的数据年照旧撑开下界
    }

    @Test void noData_lastYearToNext() {
        int now = LocalDate.now(ZoneId.of("Asia/Shanghai")).getYear();
        assertThat(YearSpan.of(List.of())).isEqualTo(new YearSpan(now - 1, now + 1, now));
        assertThat(YearSpan.thisYear()).isEqualTo(now);
    }
}
