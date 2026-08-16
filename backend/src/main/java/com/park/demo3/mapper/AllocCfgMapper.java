package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocCfg;
import java.util.List;
public interface AllocCfgMapper extends BaseMapper<AllocCfg> {
    // 唯一键 (scope,cfg_key,acct_month,mode)(V96):同月 from/month 两行可并存,取行必须带 mode
    default AllocCfg selectByKey(String scope, String cfgKey, String acctMonth, String mode) {
        return selectOne(new QueryWrapper<AllocCfg>()
            .eq("scope", scope).eq("cfg_key", cfgKey).eq("acct_month", acctMonth).eq("mode", mode));
    }
    // 某月生效行集合(默认行 '') ∪ 当月行,读侧内存解析,月行优先) —— 仅供 cfgList 兼容读;引擎 loadCtx 走
    // VersionResolver.effectiveMap(整表)。同月 from/month 并存时 month 排前(前端 resolveCfg 取首个非 '' 行)。
    default List<AllocCfg> selectEffective(String ym) {
        return selectList(new QueryWrapper<AllocCfg>().in("acct_month", "", ym)
            .orderByAsc("scope", "cfg_key").orderByDesc("mode"));
    }
}
