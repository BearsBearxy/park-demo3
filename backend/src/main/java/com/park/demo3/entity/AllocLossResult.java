package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("alloc_loss_result")
public class AllocLossResult {
    @TableId(type = IdType.AUTO) private Integer id;
    private String ym;
    private String zone;               // p1 / p2
    private Integer headBuildingId;    // 组头楼栋(共享总表组=供电栋)
    private BigDecimal cQty;           // 总表用电量
    private BigDecimal cableQty;       // 铝缆用电量(仅陈列)
    private BigDecimal dQty;           // 分表用电量Σ
    private BigDecimal eQty;           // 损耗量=D-C
    private BigDecimal rawRate;        // 原损耗率=E/C
    private BigDecimal gQty;           // 公摊分摊度数(一期;二期NULL)
    private BigDecimal adjQty;         // 调整度数(二期H列)
    private BigDecimal adjRate;        // 调整损耗加点
    private String variant;            // net / share_only / none
    private BigDecimal tenantRate;     // 收取租户损耗率
    private LocalDateTime generatedAt;
}
