package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
public record LedgerImportRequest(
    @NotNull List<Row> rows
) {
    // 21 费用列 camelCase 顺序 = LedgerSaveRequest.Row / 前端 FEE_KEYS(同序同名)
    public record Row(
        String tenantName,
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
        // 可导入的非费用列:上月结余 / 本月收款 / 备注(null=文件没这列)
        BigDecimal balancePrev, BigDecimal totalCollected, String note,
        java.util.Map<String, BigDecimal> extraFees   // 自定义列:按键合并(方案A §4)
    ) {}
}
