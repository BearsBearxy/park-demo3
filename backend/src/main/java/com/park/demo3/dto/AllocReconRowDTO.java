package com.park.demo3.dto;
import java.math.BigDecimal;
// 对账一行(§2.5):行=规则(+损耗组 ruleId=null);costAmount=应分摊(成本口径,规则用量×单价全额),
// allocated=alloc_result 当月该规则户级Σ,diff=已−成本(正盈负亏;舍入差+未覆盖户)
public record AllocReconRowDTO(
    Integer ruleId, String name, String zone, String feeKey,
    BigDecimal qty, BigDecimal price, BigDecimal costAmount, BigDecimal allocated, BigDecimal diff
) {}
