package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("alloc_pool_result")
public class AllocPoolResult {
    @TableId(type = IdType.AUTO) private Integer id;
    private String ym;
    private Integer ruleId;
    private BigDecimal qtyTotal;
    private BigDecimal qtySharp;
    private BigDecimal qtyPeak;
    private BigDecimal qtyFlat;
    private BigDecimal qtyValley;
    private BigDecimal extraQtySnap;   // 加度/扣度(进标准分子不进应分摊)
    private BigDecimal costAmount;     // 应分摊(W/AD)
    private BigDecimal baseSnap;       // 分摊基数快照
    private BigDecimal stdValue;       // 分摊标准(V/AC)
    private BigDecimal foldAdd;        // 折入叠加档,std_value 已含
    private BigDecimal priceSnap;      // p1/dorm 合成单价;p2 分时 NULL
    private BigDecimal allocatedAmount;
    private BigDecimal gapAmount;
    private String warn;
    private LocalDateTime generatedAt;
}
