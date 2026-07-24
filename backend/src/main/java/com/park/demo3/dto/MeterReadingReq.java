package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// 手工读数;读数列全可空(水表/公共表只有 total,缺本月=漏抄是常态)。factor_snap 落库时快照表倍率,req 不带。
public record MeterReadingReq(
    @NotNull Integer meterId,
    @NotBlank @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
    BigDecimal prevTotal, BigDecimal currTotal,
    BigDecimal prevSharp, BigDecimal prevPeak, BigDecimal prevFlat, BigDecimal prevValley,
    BigDecimal currSharp, BigDecimal currPeak, BigDecimal currFlat, BigDecimal currValley,
    String note
) {}
