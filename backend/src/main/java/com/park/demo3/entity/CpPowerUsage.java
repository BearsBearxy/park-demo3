package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("cp_power_usage")
public class CpPowerUsage {
    @TableId(type = IdType.AUTO) private Integer id;
    private String operator;          // 运营商
    private String vehicleType;       // car / ebike
    private LocalDate period;         // 月份(取每月1日),uk(operator, vehicle_type, period)
    private BigDecimal meterKwh;      // 电表用电量 kWh(损耗读时派生不落库)
    private String note;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
