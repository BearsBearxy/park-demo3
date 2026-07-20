package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("cp_station")
public class CpStation {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name;              // 桩名,唯一
    private String operator;          // 运营商(自由文本:万城万/小桔/…)
    private String vehicleType;       // car / ebike(附表7汽车屏 / 附表8电动车屏)
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
