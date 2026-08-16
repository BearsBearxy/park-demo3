package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.TenantPriceCfg;
public interface TenantPriceCfgMapper extends BaseMapper<TenantPriceCfg> {
    // 唯一键 (scope,cfg_key,acct_month,mode)(V96):同月 from/month 两行可并存,取行必须带 mode
    default TenantPriceCfg selectByKey(String scope, String cfgKey, String acctMonth, String mode) {
        return selectOne(new QueryWrapper<TenantPriceCfg>()
            .eq("scope", scope).eq("cfg_key", cfgKey).eq("acct_month", acctMonth).eq("mode", mode));
    }
}
