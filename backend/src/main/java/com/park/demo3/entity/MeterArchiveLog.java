package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
// 表档案每一次写的前后像(METER-TIMELINE-SPEC §1.4,V128)。抽屉「档案变更」、操作日志、撤销导入都读它。
// 不挂 meter FK:表删了,变更史照留。列名 tbl 而非 SPEC 的 table(MySQL 保留字)。
@Data @TableName("meter_archive_log")
public class MeterArchiveLog {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer meterId;
    private String tbl;             // assign / status
    private String fromYm;
    private String action;          // insert / update / delete
    private String beforeJson;
    private String afterJson;
    private String src;
    private String batchId;
    private String fileName;
    private String rowRef;
    private String operator;
    private LocalDateTime at;       // Java 时钟
}
