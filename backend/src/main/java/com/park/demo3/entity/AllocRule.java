package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("alloc_rule")
public class AllocRule {
    @TableId(type = IdType.AUTO) private Integer id;
    private String zone;          // p1 / p2
    private String name;          // 池名(V69 起由定位自动生成,不手写)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer buildingId;
    // V69 四级定位:楼栋+楼层+侧向+费项;层级留空即上一级(楼层空=整栋,楼栋空=园区级)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String floorLabel;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String side;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String feeName;
    private String method;        // direct / area / floor / loss / none / ref(V64)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal coefficient;
    private BigDecimal extraQty;  // 人工加度(默认值,rule:{id} 月行优先)
    private String feeKey;        // share_elec_* / park_loss_pool
    private Integer roundScale;   // 分摊标准 ROUND 位数(2或3,V64)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String stdKind;   // NULL=按zone默认
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String baseKey;   // 分摊基数取价目簿键,NULL=coefficient
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String note;
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
