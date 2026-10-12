/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.YearMonth;

import static org.assertj.core.api.Assertions.assertThat;

class ImportCoverageServiceTest {
    // 「到 X月X日」比到哪天:往月比到月底;本月比到昨天(今天的还没抄,不能算缺)
    @Test void dayWant_pastMonthIsMonthEnd_currentMonthIsYesterday() {
        LocalDate today = LocalDate.of(2026, 10, 10);
        assertThat(ImportCoverageService.dayWant(YearMonth.of(2026, 9), today)).isEqualTo(LocalDate.of(2026, 9, 30));
        assertThat(ImportCoverageService.dayWant(YearMonth.of(2026, 10), today)).isEqualTo(LocalDate.of(2026, 10, 9));
    }
}
