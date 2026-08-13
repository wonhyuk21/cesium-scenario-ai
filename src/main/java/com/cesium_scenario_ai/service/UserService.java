package com.cesium_scenario_ai.service;


import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import com.cesium_scenario_ai.dto.SignUpDto;
import com.cesium_scenario_ai.entity.User;
import com.cesium_scenario_ai.entity.UserRole;
import com.cesium_scenario_ai.repository.UserRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class UserService {
	
	private final UserRepository userRepository;
	private final BCryptPasswordEncoder bCryptPasswordEncoder;
	
	/*
	 * 회원가입
	 */
	public void signUp(SignUpDto signUpDto) {
		validateDuplicateUsername(signUpDto.getUsername());
		User user = CreateUserEntity(signUpDto);
		userRepository.save(user);
	}
	
	/*
	 * 중복 username 체크
	 */
	private void validateDuplicateUsername(String username) {
		if(userRepository.existsByUsername(username)) {
			log.warn("중복된 아이디 입니다: {}", username);
			throw new IllegalArgumentException("이미 사용중인 아이디입니다.");
		}
	}
	
	/*
	 * User 엔티티 생성(비밀번호 암호화 적용)
	 */
	private User CreateUserEntity(SignUpDto signUpDto) {
		return User.builder()
				.username(signUpDto.getUsername())
				.password(bCryptPasswordEncoder.encode(signUpDto.getPassword()))
				.role(UserRole.ADMIN)
				.build();
	}
}
