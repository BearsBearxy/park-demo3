package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("cp_reading")
public class CpReading {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer stationId;
    private LocalDate readDate;       // 记录日期(月份 = YYYY-MM 派生,不另存)
    private BigDecimal chargeKwh;     // 充电量 kWh
    private BigDecimal fee;           // 手续费 元
    private BigDecimal revenue;       // 收益 元(全手填,无 price_snap 概念)
    private String note;
    private String source;            // manual / import / simulated
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
