package com.cesium_scenario_ai.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class startController {

	@GetMapping("/index")
	public String start() {
		return "index";
	}

	@GetMapping("/api/hi")
	public String hi() {
		return "Hello World";
	}

}
