package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("ledger_book")
public class LedgerBook {
    @TableId(type = IdType.AUTO) private Integer id;
    private String screen;          // ledger | s10
    private Integer companyId;      // ledger 屏
    private Integer phase;          // s10 屏 1..4
    private String name;
    private Long currentVersionId;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
