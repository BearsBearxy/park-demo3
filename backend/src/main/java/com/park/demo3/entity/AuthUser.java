package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("auth_user")
public class AuthUser {
    @TableId(type = IdType.AUTO) private Integer id;
    private String username;
    private String passwordHash;
    private String displayName;
    private Integer status;
    private String role;   // admin=可写 / viewer=只读(V32,SecurityConfig GET-only 强制)
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
