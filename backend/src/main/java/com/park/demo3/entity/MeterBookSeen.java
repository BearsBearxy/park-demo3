package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
// 某表在某月导入的册子里出现过(METER-TIMELINE-SPEC §10,V130):uk(meter_id, ym, batch_id)。
// 「本月册子已核」= 存在任意一行 (meter_id, ym);撤销导入删本批的,批量删除本期按 kind/zone 删该月的。
@Data @TableName("meter_book_seen")
public class MeterBookSeen {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer meterId;
    private String ym;
    private String batchId;
    private String fileName;
    private LocalDateTime seenAt;   // Java 时钟
}
