package com.park.demo3.dto;
import java.util.List;
public record PnlOverviewDTO(List<YearMeta> years) {
    public record YearMeta(int year, boolean hasData, int rowCount) {}
}
