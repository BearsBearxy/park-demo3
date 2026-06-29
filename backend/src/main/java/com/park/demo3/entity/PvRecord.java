package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("pv_record")
public class PvRecord {
    @TableId(type = IdType.AUTO) private Integer id;
    private String phaseId;
    private String acctMonth;   // YYYY-MM 记账月
    private String occurMonth;  // YYYY-MM 发生月
    private BigDecimal selfKwh; private BigDecimal selfAmt;
    private BigDecimal gridKwh; private BigDecimal gridAmt;
    private String note;
    private String source;      // seed / manual
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
