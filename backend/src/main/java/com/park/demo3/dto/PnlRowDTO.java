package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// m 恒 12 元素,可含 null(NULL=未录,区分 0)
public record PnlRowDTO(
    String rowKey,
    String groupLabel,
    String label,
    String kind,
    String note,
    List<BigDecimal> m,
    int sortOrder
) {}
