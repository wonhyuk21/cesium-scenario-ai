package com.cesium_scenario_ai.service;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class RouteBuildingService {

	private final JdbcTemplate jdbcTemplate;
	
	public String getBuildingsInBbox(String bbox) throws Exception {
		String[] parts = bbox.split(",");
		double west = Double.parseDouble(parts[0]);
		double south = Double.parseDouble(parts[1]);
		double east = Double.parseDouble(parts[2]);
		double north = Double.parseDouble(parts[3]);
		
		String sql = "SELECT height, ST_AsGeoJSON(geom) AS geom_json "
				+ "FROM seoul_buildings "
				+ "WHERE geom && ST_MakeEnvelope(?, ?, ?, ?, 4326) "
				+ "AND height IS NOT NULL "
				+ "AND GeometryType(geom) = 'POLYGON'";
		
		// 쿼리 실행 결과 받기
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, west, south, east, north);
		
		// 각행을 geojson으로 붙이기
		StringBuilder featuresJson = new StringBuilder();
		for(int i = 0; i < rows.size(); i++) {
			Map<String, Object> row = rows.get(i);
			double height = (Double) row.get("height");
			String geometryJson = (String) row.get("geom_json");
			if(i > 0) {
				featuresJson.append(",");
			}
				// geojson feature형태의 텍스트로 조립
				featuresJson.append("{")
					.append("\"type\":\"Feature\",")
					.append("\"properties\":{\"height\":").append(height).append("},")
					.append("\"geometry\":").append(geometryJson)
					.append("}");
					
			}
			return "{\"type\":\"FeatureCollection\",\"features\":[" + featuresJson + "]}";
		}
	}
