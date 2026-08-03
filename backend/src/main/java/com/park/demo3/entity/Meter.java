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
    // ALWAYS(§F12):抽屉里 area/code/tenant_name 的「留空=清除」同样要真落 NULL。
    // 写入口只有 MeterService.apply(整条读出后再写)与 applyDesc(非空才覆盖),不会被导入误清。
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String area;
    private String spot;
    // V74 位置结构化(由 spot 解析,可人工改;spot 原文保留=导入身份键 addrKey 仍走它)
    // ALWAYS(§E8):抽屉里清空楼层/方位/房号要真落 NULL——MP 默认 NOT_NULL 会把 null 从 UPDATE 里剔掉,
    // 用户就看见「改了没生效」。三个字段的写入口只有 MeterService.apply/applyDesc,均是整条读出后再写,不会误清。
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String floorLabel;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String side;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String roomNo;
    // V76 §F6:上面三列是否人工设定。某列 0=与 spot 自动解析一致(导入跟着 spot 重解析,表挪地方自动跟上);
    // 1=人工覆盖或 §E8 显式清空(导入该列不动,原文变了只落 warn)。由 MeterService.apply() 派生维护,不收请求体。
    // V78 §G5:**位掩码**逐列判定 —— bit0(1)=楼层 / bit1(2)=方位 / bit2(4)=房号。
    // 原先是布尔:三列共用一个开关,只改房号也把楼层永久冻结,表挪了地方楼层再也不跟随。
    private Integer locManual;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String tenantName;   // 企业名称原样(未匹配兜底+对账审计,§6.1)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer tenantId;   // 关联租户,可清空(待核→指定→撤销)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer contractId; // S2 人工绑定覆盖,可解绑清空(S2-BIND-SPEC §2 规则1)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private Integer buildingId; // 关联楼栋
    // tenant/share/ops/infra/park/register(§6.1;park=园区自担 V68;
    // register=非计费计度寄存器,同一物理表的反向有功/需量等附属读数,不进任何Σ 刀H §H2 V79)
    private String ownership;
    // V77 §G2:ownership/building_id 是否人工设定。0=自动(导入照常回写自动分类结果);
    // 1=人工设定(导入两列一列不动,判定不同只落 warn)。由 MeterService.apply() 派生维护,不收请求体。
    // 单向闩:自动分类住在前端 meterSplit.ts,后端复算不出「自动结果」,故无法自动退回 0(见 V77 注释)。
    private Integer ownerManual;
    private String meterType;
    private String deviceType;    // 表类型 single|three|multi|demand|bidir(S2;meter_type 被表类原文占用)
    private String subName;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String code;
    private BigDecimal factor;    // 倍率
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String retiredYm;   // 自该账期起停用(含当月不计),可撤销清空(V68)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String activeFromYm;   // 启用账期:该月前不在服务中(V87,与retired对称);导入自愈可放宽
    // V75 §F1 存疑档案两级:shadow=疑似重复建档(不进楼栋分表Σ)/incomplete=档案不全但照常计入Σ/null=正常。
    // ALWAYS=人工在档案页保存即清标(认领)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String suspect;
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
