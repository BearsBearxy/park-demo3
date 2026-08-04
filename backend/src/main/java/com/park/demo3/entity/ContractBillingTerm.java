package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
// 计费行(BILL-FORWARD-SPEC 刀1 三次返工 §1.1):一户多位置段、每段多费项行;扁平计费行,不派生(派生属刀2)。
// ponytail: 物理表名保留 contract_billing_term(V52 +4 列复用),DTO/API 对外用 BillingLine 命名。
@Data @TableName("contract_billing_term")
public class ContractBillingTerm {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer contractId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String location;   // 位置文本(E座3-4层/宿舍楼/主…)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String propertyType; // 段类型 factory|office|dorm|shop|land(V54,段内每行冗余)
    private String feeKey;      // 13 受控枚举(V52 起);受 property_type 钉死集约束(V54)
    private String feeName;     // fee_key 中文回显(可选)
    private String billMode;    // per_sqm_month | per_month | per_room_year | per_room_month | per_kva_month
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal unitPrice;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal area;
    private BigDecimal coeff;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer roomCount;        // 门禁/网络按间计费
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal amountOverride;// per_month 模式的月额值;其他 bill_mode 下被 lineMonthly 忽略(S4 审计正名,勿按"全局覆盖"理解)
    private Integer seq;        // 位置内行序
    private BigDecimal taxRate;
    private String params;      // JSON 串,留档(不含税价/原文文本等)
    private String note;
    private String source;      // import | manual
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
