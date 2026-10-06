package com.park.demo3.mapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** 经营分析「目标与阈值」(V138 analysis_setting)。只有 AnalysisSettingService 用;一行一项,没有行 = 用默认值。 */
public interface AnalysisSettingMapper {
    @Select("SELECT setting_key AS k, setting_value AS v FROM analysis_setting")
    List<Map<String, Object>> all();

    @Insert("INSERT INTO analysis_setting (setting_key, setting_value, updated_by, updated_at) VALUES (#{k}, #{v}, #{by}, #{at}) "
          + "ON DUPLICATE KEY UPDATE setting_value = #{v}, updated_by = #{by}, updated_at = #{at}")
    int upsert(@Param("k") String key, @Param("v") BigDecimal value, @Param("by") String by, @Param("at") LocalDateTime at);
}
