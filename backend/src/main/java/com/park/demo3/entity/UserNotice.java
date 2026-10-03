package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
// 铃铛「有结果了」的一条消息(V133,PAGE-BEHAVIOR-SPEC §5.1)。seenAt null = 没看过。
@Data @TableName("user_notice")
public class UserNotice {
    @TableId(type = IdType.AUTO) private Long id;
    private String username;
    private String kind;
    private String title;
    private String detail;
    private String ref;
    private String actor;
    private LocalDateTime createdAt;   // Java 时钟
    private LocalDateTime seenAt;
}
