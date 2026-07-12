package com.park.demo3.service;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.common.*;
import com.park.demo3.dto.*;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
@Service
public class AuthService {
    private final AuthUserMapper users; private final PasswordEncoder enc; private final JwtUtil jwt;
    public AuthService(AuthUserMapper users, PasswordEncoder enc, JwtUtil jwt) {
        this.users = users; this.enc = enc; this.jwt = jwt;
    }
    public LoginResp login(LoginReq req) {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, req.username()));
        if (u == null || u.getStatus() != 1 || !enc.matches(req.password(), u.getPasswordHash()))
            throw new BizException(ResultCode.UNAUTHORIZED, "用户名或密码错误");
        return new LoginResp(jwt.generate(u.getUsername(), u.getRole()), u.getDisplayName(), u.getRole());
    }
}
