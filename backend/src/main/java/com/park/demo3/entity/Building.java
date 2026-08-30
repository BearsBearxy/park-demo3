package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("building")
public class Building {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name; private Integer phase;
    // 期区允许改回未标注(三期楼栋先标错再纠正):MyBatis-Plus 默认 update-strategy=NOT_NULL
    // 会让「清空」的 PUT 静默跳过这一列不落库,这里显式放开成 IGNORED 使 null 也真正写入。
    @TableField(updateStrategy = FieldStrategy.IGNORED) private String zone;
    private Integer floorCount;
    private BigDecimal totalArea; private BigDecimal rentableArea;
    private Integer status; private Integer perFloor; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
