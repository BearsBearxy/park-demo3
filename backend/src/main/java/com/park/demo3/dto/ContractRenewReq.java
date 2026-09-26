package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
/** 续签入参:新合同号必填;租金/押金/面积空则继承旧合同。 */
public record ContractRenewReq(
    @NotBlank @Size(max = 32) String contractNo,
    LocalDate startDate,
    LocalDate endDate,
    LocalDate signDate,
    @DecimalMin("0") BigDecimal monthlyRent,
    @DecimalMin("0") BigDecimal deposit,
    @DecimalMin("0") BigDecimal rentArea,
    // 新段 link_type(ESCALATION-SPLIT-SPEC §1):空=renew 换约;escalation=同一份合同到年限涨价的递增段
    @Pattern(regexp = "renew|escalation") String linkType
) {}
