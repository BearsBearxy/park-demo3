package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("report_amount")
public class ReportAmount {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer companyId;
    private String statement;   // 'is' | 'bs' | 'tb'
    private Integer year;
    private Integer month;
    private String rowKey;
    private String field;       // 'cur' | 'ytd'
    private BigDecimal amount;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
