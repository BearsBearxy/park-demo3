package com.park.demo3.dto;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.util.List;
public record S10ImportRequest(
    @Min(1) @Max(4) int phase,
    @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "格式应为 YYYY-MM") String acctMonth,
    @NotNull List<Row> rows
) {
    // 25 费用列 camelCase 顺序 = S10RecordReq 费用列(同序同名)
    public record Row(
        String tenantName,
        String profile,
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
        java.util.Map<String, BigDecimal> extraFees   // 自定义列(键=列固定id;未知 id 该行报错)
    ) {}
}
