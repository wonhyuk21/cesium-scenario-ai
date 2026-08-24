package com.cesium_scenario_ai.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
public class BuildingService {

	@Value("${vworld.api-key}")
	private String apiKey;

	@Value("${vworld.domain}")
	private String domain;

	private final RestClient restClient = RestClient.create();			// HTTP 요청을 보내는 도구
	private final ObjectMapper objectMapper = new ObjectMapper();		// JSON 문자열 <-> Java 객체를 변환해주는 도구

	private static final double MIN_BBOX_SIZE = 0.0005; 				// 이보다 작은 조각은 더 안 쪼갬 (안전장치)

	public String getBuildingGeoJson(String bbox) throws Exception {	// BuildingController 호출
		ArrayNode allFeatures = objectMapper.createArrayNode();			// 빈 배열 생성(모든 건물의 집합)
		fetchRecursive(bbox, allFeatures);								// 재귀 요청, allFeatures를 파라미터로 넘겨줌

		ObjectNode result = objectMapper.createObjectNode();
		result.put("type", "FeatureCollection");
		result.set("features", allFeatures);

		return objectMapper.writeValueAsString(result);
	}

	private void fetchRecursive(String bbox, ArrayNode allFeatures) throws Exception {
		String url = "https://api.vworld.kr/req/wfs"
				+ "?SERVICE=WFS"
				+ "&REQUEST=GetFeature"
				+ "&VERSION=1.1.0"
				+ "&TYPENAME=lt_c_spbd"
				+ "&PROPERTYNAME=buld_nm,gro_flo_co,und_flo_co,ag_geom"
				+ "&SRSNAME=EPSG:4326"
				+ "&OUTPUT=application/json"
				+ "&MAXFEATURES=1000"
				+ "&BBOX=" + bbox
				+ "&KEY=" + apiKey
				+ "&DOMAIN=" + domain;

		String pageJson = restClient.get().uri(url).retrieve().body(String.class);
		JsonNode root = objectMapper.readTree(pageJson);
		ArrayNode features = (ArrayNode) root.get("features");
		int totalFeatures = root.get("totalFeatures").asInt();

		if (totalFeatures > 1000 && isSplittable(bbox)) {
			for (String subBbox : splitBboxIntoFour(bbox)) {
				fetchRecursive(subBbox, allFeatures);
			}
		} else {
			allFeatures.addAll(features);
		}
	}

	private boolean isSplittable(String bbox) {
		String[] parts = bbox.split(",");
		double minLon = Double.parseDouble(parts[0]);
		double minLat = Double.parseDouble(parts[1]);
		double maxLon = Double.parseDouble(parts[2]);
		double maxLat = Double.parseDouble(parts[3]);

		return (maxLon - minLon) > MIN_BBOX_SIZE && (maxLat - minLat) > MIN_BBOX_SIZE;
	}

	private String[] splitBboxIntoFour(String bbox) {
		String[] parts = bbox.split(",");
		double minLon = Double.parseDouble(parts[0]);
		double minLat = Double.parseDouble(parts[1]);
		double maxLon = Double.parseDouble(parts[2]);
		double maxLat = Double.parseDouble(parts[3]);

		double midLon = (minLon + maxLon) / 2;
		double midLat = (minLat + maxLat) / 2;

		return new String[] {
			minLon + "," + minLat + "," + midLon + "," + midLat,
			midLon + "," + minLat + "," + maxLon + "," + midLat,
			minLon + "," + midLat + "," + midLon + "," + maxLat,
			midLon + "," + midLat + "," + maxLon + "," + maxLat
		};
	}
}