package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

/** 一把审核键的当前态(spec §7.2)。「录入中」是派生态 —— 没有行就是录入中,不落库。 */
@Data
@TableName("review_state")
public class ReviewState {
    // 主键是业务串不是自增,所以 IdType.INPUT,不是全仓惯用的 AUTO。
    // 用 AUTO 会让 MyBatis-Plus 在 insert 后往 reviewKey 回写自增值,当场把键冲掉。
    @TableId(type = IdType.INPUT) private String reviewKey;
    private String kind;
    private String period;
    private String scope;
    private String status;
    private String submittedBy;
    private LocalDateTime submittedAt;
    private String reviewedBy;
    private LocalDateTime reviewedAt;
    private String reason;
}
