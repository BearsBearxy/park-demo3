package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
@Data @TableName("auth_user_role")
public class AuthUserRole {
    private Integer userId;
    private Integer roleId;
}
