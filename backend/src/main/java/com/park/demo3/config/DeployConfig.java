package com.park.demo3.config;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.regex.Pattern;

/**
 * 这套部署是我园生产还是客户园区(2026-10-05 用户拍板「按你建议修改」)。还没有第二个客户,
 * 客户的期区 / 管理公司 / 算法都不知道,所以只管两件事,不为客户预设计:
 *  · parkTools:三处模拟填充(光伏分栋 / 电费成本 / 充电桩分桩)和损益附表自动补行只给我园用 ——
 *    它们按我园附表的口径推导,补行写的是我园母册的科目名。客户园区 gen-env.sh 写 PARK_TOOLS_ENABLED=false。
 *  · releaseBaseline:客户只看装机那一版之后的更新记录;gen-env.sh 写 RELEASE_BASELINE=生成 .env 时的版本。
 * 默认值(true / 0.0.0)就是我园生产,不用设任何变量。前端经 GET /api/app/config 取(AppConfigController)。
 */
@Component
public class DeployConfig {
    /** 同 frontend/package.json 的 version(可带 -beta.1 这类后缀)。写成 v0.29.0 之类,前端比版本得 NaN,更新记录一条都不出、也不报错。 */
    private static final Pattern VERSION = Pattern.compile("\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.]+)?");

    private final boolean parkTools;
    private final String releaseBaseline;

    public DeployConfig(@Value("${app.park-tools.enabled:true}") boolean parkTools,
                        @Value("${app.release-baseline:0.0.0}") String releaseBaseline,
                        @Value("${spring.flyway.locations:classpath:db/migration,classpath:db/common}") String flywayLocations) {
        if (!VERSION.matcher(releaseBaseline).matches()) {
            throw new IllegalStateException("RELEASE_BASELINE 要写成 0.29.0 这样的版本号(不带 v),现在是「" + releaseBaseline + "」");
        }
        // 起点链 = 新园区:两个开关必须是客户值。.env 漏写时取的默认值是我园生产的样子 —— 客户库会被模拟填充写进按我园附表推出来的行,
        // 更新记录里是我园全部历史版本。同 FlywayChainGuard 挡漏写 FLYWAY_LOCATIONS 一样,宁可起不来(2026-10-05 复查)。我园走老链,不触发
        if (flywayLocations.contains("db/baseline") && (parkTools || "0.0.0".equals(releaseBaseline))) {
            throw new IllegalStateException("新园区(FLYWAY_LOCATIONS 走起点链)的 .env 还要写 PARK_TOOLS_ENABLED=false 和 "
                    + "RELEASE_BASELINE=装机那一版(deploy/gen-env.sh 会写),现在是 " + parkTools + " / " + releaseBaseline);
        }
        this.parkTools = parkTools;
        this.releaseBaseline = releaseBaseline;
    }

    public boolean parkTools() { return parkTools; }
    public String releaseBaseline() { return releaseBaseline; }

    /**
     * 模拟填充的服务端闸:前端在客户园区已经不显按钮,这里挡绕过页面直接调接口的。
     * 回 404 不回 403:本系统 403 的文案(ResultCode.FORBIDDEN)是「无操作权限：当前账号没有修改这项数据的权限（可查看，如需修改请联系管理员开通）」,
     * 而这里换谁登录都没有,开权限也没用。
     */
    public void requireParkTools() {
        if (!parkTools) throw new BizException(ResultCode.NOT_FOUND, "这套系统没有模拟填充");
    }
}
