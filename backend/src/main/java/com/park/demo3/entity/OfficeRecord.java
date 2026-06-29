package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("office_record")
public class OfficeRecord {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer scheduleNo;    // 13 办公水电 / 14 三期水电
    private String acctMonth;      // YYYY-MM 记账月
    private String belongMonth;    // YYYY-MM 所属月
    private BigDecimal elecQty;     // 用电量(千瓦)
    private BigDecimal elecPrice;   // 基准用电单价(元/千瓦)
    private BigDecimal waterQty;    // 用水量(吨)
    private BigDecimal waterPrice;  // 基准用水单价(元/吨)
    private String note;
    private String source;         // seed / manual
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
