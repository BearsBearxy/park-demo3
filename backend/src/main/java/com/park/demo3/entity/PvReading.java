package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("pv_reading")
public class PvReading {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer stationId;
    private LocalDate readDate;       // 抄表日期(发电月份 = YYYY-MM 派生,不另存)
    private BigDecimal genTotal;      // 发电总量 kWh
    private BigDecimal selfUse;       // 自消纳电量 kWh
    private BigDecimal gridFeed;      // 上网电量 kWh
    private BigDecimal priceSnap;     // 单价快照 元/kWh(录入时站单价;调站价不回溯)
    private String note;
    private String source;            // manual / import / simulated
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
