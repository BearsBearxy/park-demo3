package com.park.demo3.dto;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
public record S10RecordReq(
    Long id,                                            // 非空=按行更新(允许改名);空=按槽+名 upsert
    Integer tenantId,                                   // 可空软引用
    @NotBlank String tenantName,
    @Min(1) @Max(4) int phase,
    @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "格式应为 YYYY-MM") String acctMonth,
    String profile,
    String note,                                        // 可空
    // ── 25 费用列(可空,null 落零) ──
    BigDecimal officeRent,
    BigDecimal officeMgmtFee,
    BigDecimal factoryRent,
    BigDecimal factoryMgmtFee,
    BigDecimal landRent,
    BigDecimal shopRent,
    BigDecimal shopMgmtFee,
    BigDecimal dormRent,
    BigDecimal dormFacilityFee,
    BigDecimal infraOffice,
    BigDecimal infraFactory,
    BigDecimal infraShop,
    BigDecimal infraDorm,
    BigDecimal elevatorMaint,
    BigDecimal transformerMaint,
    BigDecimal landUseTax,
    BigDecimal networkFee,
    BigDecimal accessMaint,
    BigDecimal otherFee,
    BigDecimal elecBasic,
    BigDecimal elecStd,
    BigDecimal elecMaint,
    BigDecimal waterStd,
    BigDecimal waterMaint,
    BigDecimal guaranteeRent,
    java.util.Map<String, BigDecimal> extraFees   // 非空=整包替换;null=不动(方案A)
) {}
