package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("auth_role")
public class AuthRole {
    @TableId(type = IdType.AUTO) private Integer id;
    private String code;          // 稳定标识,代码引用它;显示名可改
    private String name;
    private Integer builtin;      // 1=系统预置,不可删(权限仍可改)
    private String navLayers;     // 逗号分隔:data,reports,analysis(与权限脱钩,RBAC-SPEC §4)
    private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
