package com.park.demo3.dto;
import java.util.List;
public record S10OverviewDTO(
    int[] years,            // 确定性范围 [BASE_YEAR .. maxDataYear+1]
    int currentYear,        // = maxDataYear
    int currentMonth,       // = currentYear 的最大数据月
    List<S10YearDTO> summaries
) {}
