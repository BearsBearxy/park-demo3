package com.park.demo3;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class Demo3ApplicationTests extends AbstractMysqlIT {
    @Autowired JdbcTemplate jdbc;

    @Test
    void contextLoadsAndFlywayMigrated() {
        Integer tables = jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() " +
            "AND table_name IN ('building','unit','tenant','tenant_category','contract','auth_user')",
            Integer.class);
        assertThat(tables).isEqualTo(6);
    }
}
