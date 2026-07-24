package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate;
/** 租金阶梯期(CONTRACT-CARD-V2-SPEC §2)。参考排程,不参与计费(§1)。 */
@Data @TableName("contract_rent_tier")
public class ContractRentTier {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer contractId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String feeKey;   // 空=整份合同合计口径
    private Integer seq;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String label;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate startDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate endDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal unitPrice;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal monthlyAmount;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String note;
}
