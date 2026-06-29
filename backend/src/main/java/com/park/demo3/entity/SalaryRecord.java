package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("salary_record")
public class SalaryRecord {
    @TableId(type = IdType.AUTO) private Integer id;
    private String acctMonth;   // YYYY-MM 所属月份
    private Integer empIdx;      // 序号
    private String name;
    private String role;
    private BigDecimal base; private BigDecimal post; private BigDecimal perf; private BigDecimal attend;
    private BigDecimal skill; private BigDecimal edu; private BigDecimal other;
    private BigDecimal lunch; private BigDecimal heat; private BigDecimal commission;
    private Integer shouldDays; private Integer leaveDays;
    private BigDecimal social; private BigDecimal tax; private BigDecimal otherDeduct;
    private Boolean sign;
    private String note;
    private String source;      // seed / manual
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
