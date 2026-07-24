package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("alloc_result")
public class AllocResult {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer tenantId;
    private String ym;            // YYYY-MM
    private String feeKey;        // share_elec_*
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer ruleId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal qty;
    private BigDecimal amount;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal rateSnap;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal priceSnap;
    private String source;        // gen / manual
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String note;
    private LocalDateTime generatedAt;
}
