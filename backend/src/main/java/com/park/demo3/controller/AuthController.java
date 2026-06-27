package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.AuthService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
@Tag(name = "认证")
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    public AuthController(AuthService auth) { this.auth = auth; }
    @PostMapping("/login")
    public LoginResp login(@Valid @RequestBody LoginReq req) { return auth.login(req); }
}
