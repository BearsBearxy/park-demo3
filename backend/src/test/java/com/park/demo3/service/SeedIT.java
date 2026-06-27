package com.park.demo3.service;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.assertThat;
class SeedIT extends AbstractMysqlIT {
    @Autowired JdbcTemplate jdbc;
    @Test void seedLoaded() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tenant_category", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM building", Integer.class)).isGreaterThanOrEqualTo(6);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tenant", Integer.class)).isGreaterThanOrEqualTo(6);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM unit", Integer.class)).isGreaterThan(0);
        assertThat(jdbc.queryForObject("SELECT COUNT(DISTINCT status) FROM contract", Integer.class)).isGreaterThanOrEqualTo(3);
    }
}
