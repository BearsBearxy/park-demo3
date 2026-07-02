package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("report_account")
public class ReportAccount {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer companyId;
    private String statement;   // 'tb'
    private Integer year;
    private Integer month;
    private String rowKey;      // 科目代码 或 合成 r<n>
    private String parentKey;   // 父科目 row_key(一级科目 NULL)
    private String code;        // 科目代码(缩进型下级无代码为 NULL)
    private String label;       // 科目名称(去前导空格)
    private Integer level;
    private Integer sortOrder;  // 文件行序
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
}
