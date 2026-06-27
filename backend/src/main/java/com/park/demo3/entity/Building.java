package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("building")
public class Building {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name; private Integer phase; private Integer floorCount;
    private BigDecimal totalArea; private BigDecimal rentableArea;
    private Integer status; private Integer perFloor; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
