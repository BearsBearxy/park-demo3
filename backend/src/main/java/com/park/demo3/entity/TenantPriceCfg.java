package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("tenant_price_cfg")
public class TenantPriceCfg {
    @TableId(type = IdType.AUTO) private Integer id;
    private String scope;         // ''=全园 | p1/p2/dorm 分区 | tenant:{id} 户级
    private String cfgKey;        // 受控白名单(PriceCfgService.CFG_KEYS)
    private String acctMonth;     // 'YYYY-MM' 月行 | ''=默认行
    private BigDecimal cfgValue;  // DECIMAL(14,8),电价 8 位小数
    private String note;          // 数值来源锚点
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
