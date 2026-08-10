package com.cesium_scenario_ai.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TestController {
	
	@GetMapping("/admin")
	public String adminP() {
		return "Admin Controller";
	}
	
	@GetMapping("/main")
	public String mainP() {
		return "Main Controller";
	}
	
}
