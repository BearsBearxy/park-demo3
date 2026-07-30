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
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer contractId; // S2 人工绑定覆盖,可解绑清空(S2-BIND-SPEC §2 规则1)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer buildingId; // 关联楼栋
    private String ownership;     // tenant/share/ops/infra/park(§6.1;park=园区自担 V68)
    private String meterType;
    private String deviceType;    // 表类型 single|three|multi|demand|bidir(S2;meter_type 被表类原文占用)
    private String subName;
    private String code;
    private BigDecimal factor;    // 倍率
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String retiredYm;   // 自该账期起停用(含当月不计),可撤销清空(V68)
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
