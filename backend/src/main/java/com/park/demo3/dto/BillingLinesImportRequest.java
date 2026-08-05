package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 计费行批量导入(BILL-FORWARD 刀1 三次返工 §1.7,替换退役的 BillingFieldsImportRequest)。
// FeeRow 1:1:每行=一份合同的计费行合集,contractId 已由前端完成 租户→合同 匹配/multiPick。
// 覆盖律(§1.2-6):按合同整组替换 source='import' 行,人工改过(manual)行保留;落库后反向同步五标量缓存。
public record BillingLinesImportRequest(@NotNull List<Row> rows) {
    public record Row(Integer contractId, List<Line> lines) {}
    // propertyType(V55):段类型,非空则服务层按钉死集校验 feeKey 越界(行级错误跳过);老调用方不传=不校验。
    public record Line(String location, String propertyType, String feeKey, BigDecimal area, BigDecimal areaShared, BigDecimal unitPrice,
                       BigDecimal coeff, Integer roomCount, String billMode,
                       BigDecimal amountOverride, String note) {}
}
