package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("management_company")
public class ManagementCompany {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name;
    @TableField("`short`") private String shortName;
    private Integer sortNo;
    private String fullName;    // V94 法定全称,印通知单落款;空则回落 name
    private Integer status;     // V94 1=启用 0=停用
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
