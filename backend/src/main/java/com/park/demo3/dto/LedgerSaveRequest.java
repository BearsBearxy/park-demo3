package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
public record LedgerSaveRequest(
    @NotNull List<Row> rows
) {
    public record Row(
        @NotNull Integer tenantId,
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
        String  note
    ) {}
}
