package com.park.demo3.dto;
import java.math.BigDecimal;
public record ContractSummaryDTO(
    int        total,
    int        contractActive,
    int        contractExpiring,
    int        contractDraft,
    BigDecimal monthlyRent
) {}
