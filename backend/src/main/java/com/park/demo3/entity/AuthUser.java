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
    // V32 遗留:仍随 JWT 签发、仍供前端展示角色名,但 **授权判定不再看它**(V101 起走 auth_user_role)
    private String role;
    // 首次登录强制改密(V101,RBAC-SPEC 拍板 #3):管理员建号置 1,本人改完置 0
    private Integer mustChangePassword;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
