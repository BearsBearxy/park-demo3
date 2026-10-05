package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
/** 手改数据的一格(V138)。写入只走 {@link com.park.demo3.service.ChangeLogService}。 */
@Data @TableName("value_change_log")
public class ValueChangeLog {
    @TableId(type = IdType.AUTO) private Long id;
    private LocalDateTime at;
    private String actor;
    private String authorizer;   // 提权放行时的授权人(V139);null = 没走提权
    private String tbl;
    private String rowRef;
    private String field;
    private String oldVal;   // null = 原来没有这一格
    private String newVal;   // null = 删掉了
    private String note;
}
