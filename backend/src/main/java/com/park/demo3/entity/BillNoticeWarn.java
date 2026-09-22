package com.park.demo3.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

// 催缴单告警条目(V126)。随单生随单死:清理路径只有 FK ON DELETE CASCADE。
// code = WarnCode 常量名,库里不存文案;payload/hint 是实例数据(房号/价目键/计费行id/表名),
// 不是文案 —— 它们永远由前端 WARN_COPY 的 fmt 加标签之后才上屏。
@Data
@TableName("bill_notice_warn")
public class BillNoticeWarn {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer noticeId;
    private String code;
    private String payload;   // NOT NULL DEFAULT '';同一张单内必须唯一地指向一个实例(uk_warn)
    private String hint;      // NOT NULL DEFAULT ''
}
