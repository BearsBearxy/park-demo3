package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("weather_hour")
public class WeatherHour {
    @TableId(type = IdType.AUTO) private Integer id;
    private LocalDateTime obsTime;    // 观测整点(本地时,与电表日界对齐)
    private BigDecimal ghi;           // 短波太阳辐射 W/m2(瞬时功率,不是能量)
    private BigDecimal dni;           // 直射辐射 W/m2
    private BigDecimal dhi;           // 散射太阳辐射 W/m2
    private BigDecimal tempC;         // 气温 ℃
    private BigDecimal precipMm;      // 降水量 mm
    private Integer humidity;         // 相对湿度 %
    private String weatherTxt;        // 晴/多云/阴/中雨
    private String source;            // import / api
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
