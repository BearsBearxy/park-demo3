package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record LedgerMonthDTO(
    String  companyName,
    int     year,
    int     month,
    int     prevMonth,
    List<LedgerRowDTO> rows,
    LedgerFooter footer
) {
    public record LedgerRowDTO(
        Integer tenantId,
        String  tenantName,
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
        BigDecimal totalReceivable,   // 派生
        BigDecimal balanceEnd         // 派生
    ) {}

    public record LedgerFooter(
        // 21 费用列合计(顺序同 §3.1)
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
        BigDecimal balancePrev,
        BigDecimal totalReceivable,
        BigDecimal totalCollected,
        BigDecimal balanceEnd
    ) {}
}
