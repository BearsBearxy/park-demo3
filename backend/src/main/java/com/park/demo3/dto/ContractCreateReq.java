package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
public record ContractCreateReq(
    @NotBlank @Size(max = 32) String contractNo,
    @NotNull Integer tenantId,
    @NotNull Integer buildingId,
    Integer unitId,
    @DecimalMin("0") BigDecimal rentArea,
    @DecimalMin("0") BigDecimal monthlyRent,
    @DecimalMin("0") BigDecimal deposit,
    LocalDate startDate,
    LocalDate endDate,
    LocalDate signDate,
    @NotBlank @Pattern(regexp = "draft|active|expiring|terminated") String status,
    @Size(max = 255) String remark
) {}
