package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("monthly_ledger")
public class MonthlyLedger {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer companyId;
    private Integer tenantId;      // V105 起可空:null=未绑定档案(软引用)
    private String tenantName;     // V105 账面名快照(导入原文/手工改名),与档案名可不一致
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
    private BigDecimal balancePrev; private BigDecimal totalCollected;
    // note/extraFees 必须 ALWAYS:copyFromPrev/整包清空 要能把它们置回 NULL,
    // MP 缺省 NOT_NULL 会跳过 null 字段(Contract.java 面积清空同款坑,审查#0/#4)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String note;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String extraFees;   // 方案A 口袋:自定义列 JSON(键=列固定id),NULL=无
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
