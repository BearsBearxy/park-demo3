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
    // ALWAYS(§F12):抽屉里 code 的「留空=清除」要真落 NULL(MP 默认 NOT_NULL 会把 null 从 UPDATE 里剔掉)。
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String code;
    private BigDecimal factor;    // 倍率
    private String meterType;
    private String deviceType;    // 表类型 single|three|multi|demand|bidir(S2;meter_type 被表类原文占用)
    // V129:归属 / 位置 / 人工标记 / 合同钉搬进 meter_assign(按月分段),启用 / 停用 / 退场三个账期搬进 meter_status。
    // 这里只剩资产列(不分月)。站在某月看一块表 = MeterTimelineService.metersAt(ym) 给出的 MeterAt。
    // V75 §F1 存疑档案两级:shadow=疑似重复建档(不进楼栋分表Σ)/incomplete=档案不全但照常计入Σ/null=正常。
    // ALWAYS=人工在档案页保存即清标(认领)
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String suspect;
    private Integer isDormRoom;   // V89 宿舍房间表(房号计费分间);判定树②居民价/水3.85 唯一判据,建档定死不在派生时猜
    private Integer sortNo;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
