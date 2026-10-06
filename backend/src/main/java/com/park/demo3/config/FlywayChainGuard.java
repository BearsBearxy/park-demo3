package com.park.demo3.config;

import org.flywaydb.core.api.Location;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 迁移链把关(2026-10-04 用户拍板:产品卖给别的园区,每园一个库,客户能读到库里的一切;我园生产照旧跑老链)。
 * 老链 db/migration 混着我园的楼栋、租户、工资、台账,而 FLYWAY_LOCATIONS 不写就走老链 —— 新园区漏写这一项就 up,
 * 我园数据会被灌进客户库,客户自开的 RDS 一写进去(连同快照、备份)就收不回来。所以迁移前先查两件事:
 *   ① 空库(一条迁移都没跑过)遇到老链 → 拒绝启动,除非显式放行(app.flyway.allow-legacy-on-empty;dev/测试放行,
 *      CI 每次都是全新空库)。我园生产库有迁移历史,不触发。
 *   ② 只认两条链:老链 + db/common、起点链 + db/common。漏了 db/common,以后的迁移就不跑,两条链从此分叉。
 */
@Configuration
public class FlywayChainGuard {
    static final Set<String> LEGACY = Set.of("db/migration", "db/common");
    static final Set<String> BASELINE = Set.of("db/baseline", "db/common");

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy(   // 方法名别和配置类同名:同名 bean 定义会冲突,上下文起不来
            @Value("${app.flyway.allow-legacy-on-empty:false}") boolean allowLegacyOnEmpty) {
        return flyway -> {
            check(flyway.getConfiguration().getLocations(), flyway.info().applied().length, allowLegacyOnEmpty);
            flyway.migrate();
        };
    }

    static void check(Location[] locations, int applied, boolean allowLegacyOnEmpty) {
        Set<String> paths = Arrays.stream(locations).map(Location::getPath).collect(Collectors.toSet());
        if (!paths.equals(LEGACY) && !paths.equals(BASELINE)) {
            throw new IllegalStateException("FLYWAY_LOCATIONS 只能是 classpath:db/migration,classpath:db/common(我园)"
                    + "或 classpath:db/baseline,classpath:db/common(新园区),现在是 " + paths);
        }
        if (paths.equals(LEGACY) && applied == 0 && !allowLegacyOnEmpty) {
            throw new IllegalStateException("空库不能跑老迁移链(里面是我园的数据)。新园区在 .env 写 "
                    + "FLYWAY_LOCATIONS=classpath:db/baseline,classpath:db/common 再启动;"
                    + "确实要在空库上重建我园自己的库,设 FLYWAY_ALLOW_LEGACY_ON_EMPTY=true");
        }
    }
}
