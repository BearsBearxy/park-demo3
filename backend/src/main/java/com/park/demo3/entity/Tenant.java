package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("tenant")
public class Tenant {
    @TableId(type = IdType.AUTO) private Integer id;
    private String companyName; private String contactName; private String contactPhone;
    private String businessType; private Integer status; private Integer categoryId;
    private Integer phase; private String since; private String remark;
    private Integer parentId;
    private String aliases;   // 别名,逗号分隔(V86):worksheet老板名/曾用名,导入与挂号匹配同权
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
