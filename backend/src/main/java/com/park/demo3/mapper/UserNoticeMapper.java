package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.UserNotice;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
public interface UserNoticeMapper extends BaseMapper<UserNotice> {
    /**
     * 只留该人最近 keep 条。第 keep 条的 id 取不到(不足 keep 条)时子查询为 NULL,`id < NULL` 不删任何行。
     * 多包一层派生表:MySQL 不许 DELETE 的子查询直接读被删的表。
     */
    @Delete("DELETE FROM user_notice WHERE username = #{u} AND id < ("
          + "SELECT id FROM (SELECT id FROM user_notice WHERE username = #{u} ORDER BY id DESC LIMIT 1 OFFSET #{off}) k)")
    int trim(@Param("u") String username, @Param("off") int keepMinusOne);
}
