package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record ElecYearDTO(
    int year,
    String type,                 // energy / basic(本次过滤口径)
    List<ElecPhaseDTO> phases,
    List<ElecRecordDTO> rows,
    ElecTotal total
) {
    public record ElecTotal(
        BigDecimal qty,      // energy 电量合计
        BigDecimal demand,   // basic 需量合计
        BigDecimal amount,   // 不含税金额 / 基本用电费 合计
        BigDecimal tax,
        BigDecimal total     // 价税合计
    ) {}
}
