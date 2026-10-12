/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("report_custom_row")
public class ReportCustomRow {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer companyId;
    private String statement;
    private String rowKey;      // 稳定 id,如 'isc-<n>'
    private String parentKey;
    private String label;
    private Integer level;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
}
