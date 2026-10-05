package com.park.demo3.dto;
import java.util.List;
public record S10OverviewDTO(
    int[] years,            // [min(2024,minData) .. maxDataYear+1];无数据 → [去年..明年](YearSpan)
    int currentYear,        // = maxDataYear;一条数据都没有时 = 今年(YearSpan)
    int currentMonth,       // = currentYear 的最大数据月;无数据为 0
    List<S10YearDTO> summaries
) {}
