package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("auth_audit_log")
public class AuthAuditLog {
    @TableId(type = IdType.AUTO) private Long id;
    private LocalDateTime ts;
    private String actor;
    private String action;
    private String target;
    private String authorizer;   // 仅「代他人执行」的动作(如主管授权接管编辑锁)有值
    private String detail;
}
