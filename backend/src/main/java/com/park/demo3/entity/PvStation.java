package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("pv_station")
public class PvStation {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name;              // 电站名(楼栋),唯一
    private Integer phase;            // 期数 1/2/3
    private Integer metered;          // 1=已装光伏计量表 0=未安装(V118;与「装了表但漏抄」是两回事)
    private BigDecimal capacityKwp;   // 装机容量 kWp(可空)
    private BigDecimal priceYuan;     // 消纳综合单价 元/kWh(可空)
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
