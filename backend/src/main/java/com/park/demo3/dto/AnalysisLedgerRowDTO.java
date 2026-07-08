package com.park.demo3.dto;
import java.math.BigDecimal;

// 台账 租户×公司×月 slim 行(分析层一次拉全):receivable = 21 费用列Σ(同 LedgerService.recalc);
// balanceEnd = balancePrev + receivable − collected。
public record AnalysisLedgerRowDTO(int companyId, String companyName, int year, int month,
                                   Integer tenantId, String tenantName,
                                   BigDecimal balancePrev, BigDecimal receivable,
                                   BigDecimal collected, BigDecimal balanceEnd) {}
