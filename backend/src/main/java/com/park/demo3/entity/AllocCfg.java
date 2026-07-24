package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("alloc_cfg")
public class AllocCfg {
    @TableId(type = IdType.AUTO) private Integer id;
    private String scope;         // p1/p2 或 building:{id}
    private String cfgKey;
    private BigDecimal cfgValue;
    private String acctMonth;     // ''=默认行
    private String note;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
