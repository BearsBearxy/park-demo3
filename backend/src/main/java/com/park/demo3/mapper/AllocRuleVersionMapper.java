package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRuleVersion;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

public interface AllocRuleVersionMapper extends BaseMapper<AllocRuleVersion> {
    // 写一个版本组(含空组)时登记它;已登记即不动(主键三列)
    @Insert("INSERT IGNORE INTO alloc_rule_version (rule_id, part, acct_month) VALUES (#{ruleId}, #{part}, #{month})")
    int upsert(@Param("ruleId") Integer ruleId, @Param("part") String part, @Param("month") String month);
}
