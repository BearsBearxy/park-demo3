package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("pnl_row")
public class PnlRow {
    @TableId(type = IdType.AUTO) private Long id;
    private String schedule;      // 's1'..'s5'
    private Integer year;
    private String rowKey;        // 合成 r<n>
    private String groupLabel;    // 分组列(区域/科目名称/项目/科目)
    private String label;         // 科目细分
    private String kind;          // detail|subtotal|pnl|total(仅渲染用)
    private String note;
    // 12 月金额,NULL=未录(区分 0)
    private BigDecimal m1; private BigDecimal m2; private BigDecimal m3; private BigDecimal m4;
    private BigDecimal m5; private BigDecimal m6; private BigDecimal m7; private BigDecimal m8;
    private BigDecimal m9; private BigDecimal m10; private BigDecimal m11; private BigDecimal m12;
    private Integer sortOrder;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
