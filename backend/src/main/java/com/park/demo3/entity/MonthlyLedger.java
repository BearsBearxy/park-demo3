package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("monthly_ledger")
public class MonthlyLedger {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer companyId; private Integer tenantId;
    private Integer periodYear; private Integer periodMonth;
    // 21 费用列(顺序同 §3.1)
    private BigDecimal factoryRent; private BigDecimal factoryMgmtFee;
    private BigDecimal shopRent; private BigDecimal dormRent;
    private BigDecimal dormFacilitiesFee; private BigDecimal shopMgmtFee;
    private BigDecimal factoryInfraMaint; private BigDecimal shopInfraMaint;
    private BigDecimal dormInfraMaint;
    private BigDecimal elevatorMaint; private BigDecimal transformerMaint;
    private BigDecimal landUseTax; private BigDecimal networkFee;
    private BigDecimal accessCtrlMaint; private BigDecimal officeOtherFee;
    private BigDecimal dormOtherFee;
    private BigDecimal basicElectricity; private BigDecimal standardElectricity;
    private BigDecimal electricityMaint;
    private BigDecimal standardWater; private BigDecimal waterMaint;
    // 录入字段
    private BigDecimal balancePrev; private BigDecimal totalCollected; private String note;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
