package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("alloc_rule")
public class AllocRule {
    @TableId(type = IdType.AUTO) private Integer id;
    private String zone;          // p1 / p2
    private String name;          // 规则名(如 B座电梯)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer buildingId;
    private String method;        // direct / area / floor / loss
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal coefficient;
    private BigDecimal extraQty;  // 人工加度
    private String feeKey;        // share_elec_*
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String note;
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
