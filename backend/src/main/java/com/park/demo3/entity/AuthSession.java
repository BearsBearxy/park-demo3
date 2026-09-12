package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 登录会话(V125)。**不在鉴权路径上** —— 鉴权闸是 auth_user.token_version,走内存快照。
 * 这张表回答的是「谁在线、从哪登的、什么时候被谁踢的」,给审计与系统屏看。
 */
@Data @TableName("auth_session")
public class AuthSession {
    @TableId(type = IdType.INPUT) private String id;
    private String username;
    private Integer tokenVersion;
    private LocalDateTime createdAt;
    private LocalDateTime lastSeenAt;
    private LocalDateTime expiresAt;
    private LocalDateTime revokedAt;
    private String revokedBy;
    private String clientIp;
    private String userAgent;
}
