package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("recon_mark")
public class ReconMark {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer year; private Integer month;
    private Integer tenantId;       // 匹配上的真实租户(可空)
    private String tenantName;      // 展示名/未匹配实体的键(uk 键)
    private String note;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
