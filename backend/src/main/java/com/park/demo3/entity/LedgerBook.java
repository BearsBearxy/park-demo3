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
    // 只对"链宿主"有意义:台账全局宿主行与 s10 各期区册用它标链尾。
    // 台账的公司册这一列已作废(2026-08-26 spec §5),V111 回填时置 NULL ——
    // 公司册某月用哪一版由 book_month_pin 说了算,别拿这个字段当"当前版"
    private Long currentVersionId;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
