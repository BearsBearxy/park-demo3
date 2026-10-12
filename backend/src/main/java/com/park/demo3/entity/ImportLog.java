/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("import_log")
public class ImportLog {
    @TableId(type = IdType.AUTO) private Long id;
    private String dataType;
    private String typeLabel;
    private String fileName;
    private String target;
    private String periodFrom;   // 导到哪(V141):月 2026-09 / 日 2026-10-01 / 年 2026;旧行空
    private String periodTo;
    private Integer companyId;
    private String zone;
    @TableField("`rows`") private Integer rows;   // rows 是 MySQL 保留字,列名加反引号
    private Integer ok;
    private Integer warn;
    private String status;
    private String note;         // 被拒原因(V141)
    private String operator;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
}
