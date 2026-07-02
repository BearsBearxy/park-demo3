package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 保存本期:覆盖该期该公司该 statement 全部金额(clear+insert);tb 另可带 accounts 整期覆盖科目树(is/bs 传 null 忽略)
public record ReportSaveReq(List<Cell> cells, List<AccountReq> accounts) {
    public record Cell(String rowKey, String field, BigDecimal amount) {}
    public record AccountReq(String rowKey, String parentKey, String code, String label, Integer level, Integer sortOrder) {}
}
