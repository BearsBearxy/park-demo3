package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
public record LedgerSaveRequest(
    @NotNull List<Row> rows
) {
    // 行身份二选一:tenantId(绑定行/新增行) 或 id(既有行,含未绑定行)。两者都空该行报 400。
    // tenantName = 账面名快照:提供即改名(绑定行只改快照;未绑定行改名后自动尝试按新名配档)。
    public record Row(
        Integer id,
        Integer tenantId,
        String tenantName,
        BigDecimal balancePrev,
        // 21 费用列(顺序同 §3.1)
        BigDecimal factoryRent, BigDecimal factoryMgmtFee,
        BigDecimal shopRent, BigDecimal dormRent,
        BigDecimal dormFacilitiesFee, BigDecimal shopMgmtFee,
        BigDecimal factoryInfraMaint, BigDecimal shopInfraMaint,
        BigDecimal dormInfraMaint,
        BigDecimal elevatorMaint, BigDecimal transformerMaint,
        BigDecimal landUseTax, BigDecimal networkFee,
        BigDecimal accessCtrlMaint, BigDecimal officeOtherFee,
        BigDecimal dormOtherFee,
        BigDecimal basicElectricity, BigDecimal standardElectricity,
        BigDecimal electricityMaint,
        BigDecimal standardWater, BigDecimal waterMaint,
        BigDecimal totalCollected,
        String  note,
        java.util.Map<String, BigDecimal> extraFees   // 非空=整包替换;null=不动(方案A)
    ) {}
}
