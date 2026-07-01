package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ImportLog;
import org.apache.ibatis.annotations.Mapper;
import java.time.LocalDateTime;
import java.util.*;
@Mapper
public interface ImportLogMapper extends BaseMapper<ImportLog> {
    // 每 data_type 最新一条(数据量小:全量按时间倒序后 Java 端按 type 取首条)
    default List<ImportLog> latestByType() {
        List<ImportLog> all = selectList(new QueryWrapper<ImportLog>().orderByDesc("created_at", "id"));
        Map<String, ImportLog> firstByType = new LinkedHashMap<>();
        for (ImportLog r : all) firstByType.putIfAbsent(r.getDataType(), r);
        return new ArrayList<>(firstByType.values());
    }
    // 近 days 天倒序,截断 limit
    default List<ImportLog> recent(int days, int limit) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        return selectList(new QueryWrapper<ImportLog>()
            .ge("created_at", since).orderByDesc("created_at", "id").last("limit " + limit));
    }
}
