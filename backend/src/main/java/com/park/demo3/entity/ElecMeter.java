package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("elec_meter")
public class ElecMeter {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name;      // 电表名,唯一
    private String kind;      // master / dorm / ops
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
