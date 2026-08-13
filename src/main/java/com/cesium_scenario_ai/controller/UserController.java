package com.cesium_scenario_ai.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.cesium_scenario_ai.dto.SignUpDto;
import com.cesium_scenario_ai.service.UserService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class UserController {

	private final UserService userService;
	
	/*
	 * 회원가입 API
	 */
	@PostMapping("api/auth/signup")
	public ResponseEntity<String> signUp(@RequestBody SignUpDto signUpDto) {
		try {
			userService.signUp(signUpDto);
			return ResponseEntity.ok("회원가입 성공");
		} catch(IllegalArgumentException e) {
			return ResponseEntity.badRequest().body(e.getMessage());
		}		
	}
}
