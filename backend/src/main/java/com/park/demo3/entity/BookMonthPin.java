package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

/** 某册某月生效的模板版本(2026-08-26)。owner_id:ledger=company_id, s10=phase。 */
@Data
@TableName("book_month_pin")
public class BookMonthPin {
    @TableId(type = IdType.AUTO) private Long id;
    private String screen;
    private Integer ownerId;
    private Integer periodYear;
    private Integer periodMonth;
    private Long versionId;
    private LocalDateTime createdAt;
}
