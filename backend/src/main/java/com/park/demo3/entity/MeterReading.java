package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("meter_reading")
public class MeterReading {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer meterId;
    private String ym;                // YYYY-MM,uk(meter_id,ym)
    private BigDecimal prevTotal;
    private BigDecimal currTotal;
    private BigDecimal prevSharp;
    private BigDecimal prevPeak;
    private BigDecimal prevFlat;
    private BigDecimal prevValley;
    private BigDecimal currSharp;
    private BigDecimal currPeak;
    private BigDecimal currFlat;
    private BigDecimal currValley;
    private BigDecimal factorSnap;    // 倍率快照,改表倍率不回溯
    private String note;
    private String source;            // manual / import
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
