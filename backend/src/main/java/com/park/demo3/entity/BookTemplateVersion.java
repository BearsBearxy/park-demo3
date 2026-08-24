package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("book_template_version")
public class BookTemplateVersion {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer bookId;
    private Integer ver;
    private String definition;      // JSON:groups[{id,label,cols[{id,std,label,aliases,slot,hidden,w}]}]
    private String note;
    private String createdBy;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
}
