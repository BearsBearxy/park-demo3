/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
@Data @TableName("auth_role_perm")
public class AuthRolePerm {
    private Integer roleId;
    private String perm;          // 取值见 security/Perm.java
}
