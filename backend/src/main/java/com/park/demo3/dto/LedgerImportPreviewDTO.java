/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * 台账导入预演(核对页那张 5 列表,用户 2026-10-14 选「后端预演」):原样跑一遍导入、读出结果后整体回滚。
 * rows 按文件行序,一行 = 文件第 rowIndex 行落到的那户导入后的四个数(同名两行指向同一户,数一样);
 * errors 是导入时会跳过的行(同 ImportResultDTO.errors)。
 */
public record LedgerImportPreviewDTO(List<Row> rows, List<ImportError> errors) {
    public record Row(int rowIndex, String tenantName, BigDecimal balancePrev, BigDecimal totalReceivable,
                      BigDecimal totalCollected, BigDecimal balanceEnd) {}
}
