package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("meter")
public class Meter {
    @TableId(type = IdType.AUTO) private Integer id;
    private String kind;          // elec / water
    private String zone;          // p1 / p2 / dorm
    private String name;          // 首列标识名,uk(kind,zone,name)
    private String area;
    private String spot;
    private String tenantName;    // 企业名称原样(未匹配兜底+对账审计,§6.1)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer tenantId;   // 关联租户,可清空(待核→指定→撤销)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer buildingId; // 关联楼栋
    private String ownership;     // tenant/share/ops/infra(§6.1)
    private String meterType;
    private String subName;
    private String code;
    private BigDecimal factor;    // 倍率
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
