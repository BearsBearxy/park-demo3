package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.UserSeen;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
public interface UserSeenMapper extends BaseMapper<UserSeen> {
    /** 有就改、没有就建;传 null 的那一列保持原值(两处入口各写各的列,互不覆盖)。 */
    @Insert("INSERT INTO user_seen (username, changelog_version, bell_key, updated_at) VALUES (#{u}, #{v}, #{b}, NOW()) "
          + "ON DUPLICATE KEY UPDATE changelog_version = COALESCE(VALUES(changelog_version), changelog_version), "
          + "bell_key = COALESCE(VALUES(bell_key), bell_key), updated_at = NOW()")
    int upsert(@Param("u") String username, @Param("v") String changelogVersion, @Param("b") String bellKey);
}
