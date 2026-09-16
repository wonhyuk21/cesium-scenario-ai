package com.cesium_scenario_ai.controller;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.cesium_scenario_ai.service.RouteBuildingService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class RouteBuildingController {

	private final RouteBuildingService routeBuildingService;

	@GetMapping("/api/route-buildings")
	public ResponseEntity<String> getRouteBuildings(@RequestParam String bbox) throws Exception {
		String geoJson = routeBuildingService.getBuildingsInBbox(bbox);
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(geoJson);
	}
}
