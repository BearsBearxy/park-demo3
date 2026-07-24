package com.park.demo3.dto;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
/** 租金阶梯期写 Req(内嵌 ContractCreateReq,整组替换)。 */
public record RentTierReq(
    Integer id, @Size(max = 24) String feeKey, Integer seq, @Size(max = 64) String label,
    String startDate, String endDate,
    BigDecimal unitPrice, BigDecimal monthlyAmount, @Size(max = 255) String note
) {}
