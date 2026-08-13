package com.cesium_scenario_ai.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.cesium_scenario_ai.entity.User;

// 테이블에 접근하는 역할을 전담하는 인터페이스
public interface UserRepository extends JpaRepository<User, Integer>{
	
	Boolean existsByUsername(String username);		// 회원 가입
	
	Optional<User> findByUsername(String username); // 로그인
}
