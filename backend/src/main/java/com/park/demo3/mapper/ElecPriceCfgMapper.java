package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ElecPriceCfg;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
public interface ElecPriceCfgMapper extends BaseMapper<ElecPriceCfg> {
    // uk(acct_month, cfg_key) 单行;acctMonth ''=默认行(无则 null)
    default ElecPriceCfg selectByKey(String acctMonth, String cfgKey) {
        return selectOne(new QueryWrapper<ElecPriceCfg>()
            .eq("acct_month", acctMonth).eq("cfg_key", cfgKey));
    }
}
