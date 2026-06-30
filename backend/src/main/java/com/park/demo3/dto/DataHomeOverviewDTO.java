package com.park.demo3.dto;
import java.util.List;
public record DataHomeOverviewDTO(
    Period period,
    int progressDone, int progressTotal, int pct,
    List<DataHomeKpiDTO> kpis,
    List<DataHomeSourceDTO> sources,
    List<DataHomeTaskDTO> tasks,
    List<DataHomeRecentDTO> recent
) {
    public record Period(int year, int month, String label) {}
}
