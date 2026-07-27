package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.TenantPriceCfg;
public interface TenantPriceCfgMapper extends BaseMapper<TenantPriceCfg> {
    default TenantPriceCfg selectByKey(String scope, String cfgKey, String acctMonth) {
        return selectOne(new QueryWrapper<TenantPriceCfg>()
            .eq("scope", scope).eq("cfg_key", cfgKey).eq("acct_month", acctMonth));
    }
}
