package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
// 计费行↔单元绑定(V91,跨楼层公摊修缮 2026-08-09):行级绑定,比 contract_unit(合同级)细一层——
// 一份合同的两行计费行可以在不同楼层(陈相钊:二楼462.87㎡+三楼2000㎡),楼层面积口径必须落在行上。
@Data @TableName("billing_term_unit")
public class BillingTermUnit {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer termId;
    private Integer unitId;
    private String source;   // derived=位置文本推导 | manual=人工指认
}
