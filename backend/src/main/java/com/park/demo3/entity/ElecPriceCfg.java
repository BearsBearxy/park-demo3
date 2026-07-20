package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("elec_price_cfg")
public class ElecPriceCfg {
    @TableId(type = IdType.AUTO) private Integer id;
    private String acctMonth;    // YYYY-MM;''=长期默认行
    private String cfgKey;       // pv_grid_price / grid_posted_price / third_party_price / pf_reward_rate
    private BigDecimal cfgValue; // ponytail: 列名 cfg_value 避开 value 关键字疑虑,DTO 仍暴露 value
    private String note;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
