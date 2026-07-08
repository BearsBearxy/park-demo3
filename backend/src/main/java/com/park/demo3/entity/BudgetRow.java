package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("budget_row")
public class BudgetRow {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer year;
    private String label;             // 科目(trim 后)
    private Boolean sub;              // 「其中：」子行
    private BigDecimal amountBudget;  // NULL=该年无预算
    private BigDecimal amountActual;  // NULL=该年无发生额
    private String note;
    private Integer sortOrder;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
