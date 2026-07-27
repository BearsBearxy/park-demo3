package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("contract")
public class Contract {
    @TableId(type = IdType.AUTO) private Integer id;
    private String contractNo; private Integer tenantId; private Integer buildingId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer unitId;
    private BigDecimal rentArea; private BigDecimal monthlyRent; private BigDecimal deposit;
    // V33 面积模型:建筑面积㎡ / 租金单价 元每㎡月,均可空;rent_free=免租期 JSON 数组,写入口校验。
    // updateStrategy=ALWAYS:PUT 全字段语义,可空列清空须落库(裁定① 建筑面积清空重算 bug 根因=MP 缺省忽略 null)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal buildingArea;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal unitPrice;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String rentFree;
    // V51 五费项+电费签约要素(BILL-FORWARD 刀1 二次返工,方案A 宽表):
    // 租金单价复用 unitPrice;电梯规则=货梯N×150×计费层L,变压器规则=KVA<150(含未填)159/≥150 1元/KVA,覆盖月额优先。
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal mgmtFeePrice;    // 管理费单价 元/㎡/月
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal infraFeePrice;   // 基础维护单价 元/㎡/月
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer elevatorCount;      // 货梯数N
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer elevatorFloors;     // 计费层数L(已扣首层)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal elevatorFee;     // 电梯覆盖月额
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal transformerFee;  // 变压器覆盖月额
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String powerType;           // industrial|commercial|resident
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal kva;             // 配电容量(报装 kVA);不限用电分类(2026-07-27,商业/宿舍商铺也收容量费)
    private String feeSrc;   // 字段级来源 JSON {rent|mgmt|infra|elevator|transformer|area: import|manual}
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate startDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate endDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate signDate;
    // V55 期限原文三件套(合同导入):原文原样留档,起止日期是解析产物,原文才是凭据
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String termText;       // 期限原文
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String termType;       // explicit|multiple|relative|none
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String tierPriceNote;  // 分年阶梯价说明(AH 列原文)
    private String status;   // 存储态 draft|active|terminated|renewed(V54);展示态由 endDate 派生(§5.1)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer parentContractId;  // 续签链:被续签旧合同 id(V54)
    private String linkType; // V57 相对父期链接类型 new|renew|escalation(ESCALATION-SPLIT-SPEC §1),仅显示与留痕
    private String kind;     // V59 合同性质 normal|master_lease(整体承租不计KPI);无 ALWAYS 策略,PUT 不碰,标记走脚本
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
