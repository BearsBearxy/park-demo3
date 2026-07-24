package com.park.demo3.dto;
import java.math.BigDecimal;
/** 租金阶梯期读 DTO(CONTRACT-CARD-V2-SPEC §7)。参考排程,不参与计费(§1)。 */
public record RentTierDTO(
    Integer id, Integer contractId, String feeKey, Integer seq, String label,
    String startDate, String endDate,          // ISO yyyy-MM-dd,可空(相对期限)
    BigDecimal unitPrice, BigDecimal monthlyAmount, String note
) {}
