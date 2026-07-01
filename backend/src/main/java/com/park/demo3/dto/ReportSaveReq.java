package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 保存本期:覆盖该期该公司该 statement 全部金额(clear+insert)
public record ReportSaveReq(List<Cell> cells) {
    public record Cell(String rowKey, String field, BigDecimal amount) {}
}
