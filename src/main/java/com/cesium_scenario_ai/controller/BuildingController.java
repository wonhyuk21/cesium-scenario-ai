package com.cesium_scenario_ai.controller;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.cesium_scenario_ai.service.BuildingService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class BuildingController {

	private final BuildingService buildingService;
	
	@GetMapping("/api/buildings")
	public ResponseEntity<String> getBuildings(@RequestParam String bbox) throws Exception {
		String geoJson = buildingService.getBuildingGeoJson(bbox);
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(geoJson);
	}
}
