package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocCfg;
import java.util.List;
public interface AllocCfgMapper extends BaseMapper<AllocCfg> {
    default AllocCfg selectByKey(String scope, String cfgKey, String acctMonth) {
        return selectOne(new QueryWrapper<AllocCfg>()
            .eq("scope", scope).eq("cfg_key", cfgKey).eq("acct_month", acctMonth));
    }
    // 某月生效行集合:默认行('') ∪ 当月行(读侧内存解析,月行优先)
    default List<AllocCfg> selectEffective(String ym) {
        return selectList(new QueryWrapper<AllocCfg>().in("acct_month", "", ym).orderByAsc("scope", "cfg_key"));
    }
}
