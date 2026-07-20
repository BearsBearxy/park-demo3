package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("elec_cost_entry")
public class ElecCostEntry {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer meterId;
    private String acctMonth;   // YYYY-MM
    private String feeKey;      // ElecCostService.FEE_* 值域
    private String subKey;      // 楼栋拆分;''=合计行(空串归一化,uk 四元组成员)
    private BigDecimal amount;  // 金额 元
    private BigDecimal qty;     // 电量 kWh(可空)
    private String note;
    private String source;      // manual / import / simulated
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
