package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
// 池核算逐表明细快照(V73,原册一表一行):与 alloc_pool_result 同批生成/同批删除。
@Data @TableName("alloc_pool_meter_result")
public class AllocPoolMeterResult {
    @TableId(type = IdType.AUTO) private Integer id;
    private String ym;
    private Integer ruleId;
    private Integer meterId;
    private Integer sign;
    private Integer seq;               // 池内行序
    private BigDecimal factorSnap;
    private BigDecimal prevTotal;
    private BigDecimal currTotal;
    private BigDecimal qtyTotal;
    private BigDecimal qtySharp;
    private BigDecimal qtyPeak;
    private BigDecimal qtyFlat;
    private BigDecimal qtyValley;
    private BigDecimal costAmount;     // p1/dorm 逐表ROUND有值;p2 池级一次ROUND → NULL
    private LocalDateTime generatedAt;
}
