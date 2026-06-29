package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
public record SalaryRecordReq(
    @NotBlank String acctMonth,
    @NotBlank String name,
    String  role,
    BigDecimal base,
    BigDecimal post,
    BigDecimal perf,
    BigDecimal attend,
    BigDecimal skill,
    BigDecimal edu,
    BigDecimal other,
    BigDecimal lunch,
    BigDecimal heat,
    BigDecimal commission,
    Integer shouldDays,
    Integer leaveDays,
    BigDecimal social,
    BigDecimal tax,
    BigDecimal otherDeduct,
    String  note
) {}
