package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

/** 审核动作留痕。at 由 service 显式赋值(照 AuditLogService 的 setTs),DB 默认只是兜底。 */
@Data
@TableName("review_log")
public class ReviewLog {
    @TableId(type = IdType.AUTO) private Long id;
    private String reviewKey;
    private String action;
    private String actor;
    private LocalDateTime at;
    private String reason;
}
