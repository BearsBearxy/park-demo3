package com.park.demo3.dto;
import java.util.List;

// 刀H §H5 抄表批量删除(按账期)。预览与实删**共用同一形状**:
// 预览多一个字段、少一条清单,IT 就没法「拿两个 DTO 逐格比」,预览撒谎当场穿帮的这条线就断了。
//   readings/meters/metersEmptied/derived —— 规范里那四个数;
//   manualKept   —— alloc_result source='manual' 保留行的点名(规范:manual 保留并在预览里点名);
//   meterDeleted —— 连带删掉的表档案(仅 dropEmptyMeters=true 时非空);
//   meterBlocked —— 删完零读数但被 alloc_rule_meter FK 挡住、跳过的表档案(不静默失败)。
// 注:derived 是**整月口径**(alloc_pool_result/alloc_pool_meter_result/alloc_loss_result/alloc_result gen 四表
// 该 ym 全量),不随 kind/zone 收窄 —— 派生快照本就是全园区一次算出来的,删掉一部分读数它整月都不再可信。
public record MeterDeleteDTO(
    String ym,
    int readings,
    int meters,
    int metersEmptied,
    int derived,
    List<String> manualKept,
    List<String> meterDeleted,
    List<String> meterBlocked
) {}
