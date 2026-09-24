package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
// 抄表数据改动流水(METER-TIMELINE-SPEC §1.5,V128):给「需重算」用,一月一条。
// changed_at 由 Java 时钟写,与快照 generated_at 同一口钟(同 ParamService 对 param_change_log.ts 的约束)。
@Data @TableName("data_change_log")
public class DataChangeLog {
    @TableId(type = IdType.AUTO) private Long id;
    private String ym;
    private String source;          // meter-archive / meter-reading
    private LocalDateTime changedAt;
}
