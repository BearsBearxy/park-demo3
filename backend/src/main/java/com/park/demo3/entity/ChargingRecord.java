package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("charging_record")
public class ChargingRecord {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer scheduleNo;   // 7 / 8
    private String cat;           // 充电桩类别 id
    private String acctMonth;     // YYYY-MM 记账月
    private BigDecimal kwh;        // 充电电量(千瓦时)
    private BigDecimal fee;        // 手续费及服务费金额
    private BigDecimal cost;       // 充电成本金额
    private String note;
    private String source;        // seed / manual
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
