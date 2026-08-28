import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as SunCalc from 'suncalc'
import * as turf from '@turf/turf'
import '../App.css'

function parseJwt(token) {
  const base64Payload = token.split('.')[1]
  const decoded = atob(base64Payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(decoded)
}

// 태양의 방위각(azimuth), 고도각(altitude)을 도(degree) 단위로 계산
function getSunPosition(date, lat, lon) {
  console.log('입력값: ', {date, lat, lon})
  const sunPos = SunCalc.getPosition(date, lat, lon)
  console.log('getSunPosition에서 altitude', sunPos.altitude)
  console.log('getSunPosition에서 azimuth', sunPos.azimuth)
  return {
    altitude: sunPos.altitude,
    azimuth: sunPos.azimuth,
  }
} /* getSunPosition */

// 건물 외곽선과 높이, 태양 위치를 받아 그림자 폴리곤 계산
function calculateShadowPolygon(footprintCoordinates, heightMeters, sunAltitudeDeg, sunAzimuthDeg) {
  // 고도각 0 이하면 그림자 없음 처리
  if(sunAltitudeDeg <= 0) return null

  // 그림자 길이 = 건물높이 / tan(고도각)
  const shadowLength = heightMeters / Math.tan(Cesium.Math.toRadians(sunAltitudeDeg))
  // 그림자 방향 = 방위각 + 180"
  const shadowDirection = (sunAzimuthDeg + 180) % 360
  
  // 건물 외곽선의 각 점을 그림자 방향으로 이동
  const projectedCoords = footprintCoordinates.map(([lon, lat]) => {
    // lon, lat을 기준으로 shadowLength, shadowDirection만큼 떨어진 좌표를 계산
    const projected = turf.destination([lon, lat], shadowLength, shadowDirection, { units: 'meters' })
    return projected.geometry.coordinates
  })

  // 원래 외곽선 점 + 이동된 점을 합쳐서 볼록 껍질(그림자 전체 모양) 계산
  const allPoints = turf.featureCollection(   // 여러개의 점을 하나로 묶음으로 만듬
    [...footprintCoordinates, ...projectedCoords].map((coord) => turf.point(coord))
  )
  // 입력된 점을 모두 감싸는 볼록 껍질 폴리곤 계산
  const shadowHull = turf.convex(allPoints)

  return shadowHull
} /* calculateShadowPolygon */

// 브이월드 wfs 요청
async function loadWorldBuildings(viewer, bbox, isStillLatest, sunPos) {
  const token = localStorage.getItem('token')

  try {
    const response = await fetch(`/api/buildings?bbox=${bbox}`, {
      headers: { Authorization: `Bearer ${token}`},
    })

    if(!response.ok) {
      console.error('건물데이터 요청 실패:', response.status)
      return
    }

    const geoJson = await response.json()
    console.log('geoJson', geoJson)

    // strictMode에서 반환된 함수에 대한 뷰어A를 제거
    // strictMode가 개발 중 마운트 > 언마운트 > 재마운트 시 이전 뷰어 파괴에도 그 뷰어의 fetch의 응답을 막기 위해 사용
    if(viewer.isDestroyed()) return
    // 최신 요청이 더 나갔다면 이 응답은 버림(moveEnd에 대한 fetch)
    if(!isStillLatest()) return

    // 이전 화면 범위의 건물들 지우고 새로 그림(카메라가 이동했기 때문)
    viewer.entities.removeAll()

    // 건물 높이 계산
    geoJson.features.forEach((feature) => {
      const floors = feature.properties.gro_flo_co ?? 1   // 층수가 없으면 기본 1층
      const height = floors * 3                           // 건물 층고를 기본 3m 가정

      // 멀티폴리곤의 첫번째 외곽선 계산
      feature.geometry.coordinates.forEach((polygon) => {
        const outerRing = polygon[0]
        const positions = outerRing.flatMap(([lon, lat]) => [lon, lat])

        viewer.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
            extrudedHeight: height,
            height: 0,
            material: Cesium.Color.LIGHTGRAY.withAlpha(1),
            outline: true,
            outlineColor: Cesium.Color.BLACK,
          },
        })
        // 그림자 계산
        const shadowHull = calculateShadowPolygon(outerRing, height, sunPos.altitude, sunPos.azimuth)
        /*const testFootprint = [
          [126.908, 37.480],
          [126.9082, 37.480],
          [126.9082, 37.4802],
          [126.908, 37.4802],
          [126.908, 37.480],
        ]*/
        // const shadowHull = calculateShadowPolygon(outerRing, 30, sunPos.altitude, sunPos.azimuth)
        if(shadowHull === null) return
        shadowHull.geometry.coordinates.forEach((polygon) => {
          const positions = polygon.flatMap(([lon, lat]) => [lon, lat])
          
          
          viewer.entities.add({
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
              extrudedHeight: 0,
              height: 0,
              material: Cesium.Color.BLACK.withAlpha(0.4),
              outline: false,
              outlineColor: Cesium.Color.BLACK,
            },
          })
        })
      })
    })
  } catch (error) {
    console.error('브이월드 건물 로드 실패:', error)
  }
} /* loadWorldBuildings */

function App() {
  const [ count, setCount ] = useState(0) 
  const [ user, setUser ] = useState(null)
  const [ timeOffsetHours, setTimeOffsetHours ] = useState(0)
  const [ time, setTime ] = useState(new Date())
  const [ message, setMessage ] = useState('')
  const navigate = useNavigate()
  const viewerRef = useRef(null)
  const cesiumViewerRef = useRef(null)
  const updateFnRef = useRef(() => {})

  useEffect(() => {
  const token = localStorage.getItem('token')
  if(token) {
    const payload = parseJwt(token)
    setUser({ username: payload.username, role: payload.role })
  }
}, [])

  useEffect(() => {
    // 1초마다 실행되는 타이머 설정
    const timer = setInterval(() => {
      setTime(new Date())
    }, 1000)
    
    // 컴포넌트가 사라질 때 타이머 정리
    return () => clearInterval(timer)
  }, [])

  // 로그아웃 처리
  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/')
  }

  // ai 호출 및 프롬프트 전달
  const handleCallGemini = async (message) => {
    console.log('ai 호출', message)
    const response = await fetch('/api/gemini', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({message}),
    
    })
    if(!response.ok) return
  }

  // main 영역 실시간 가져오기
  const handleTimeStep = (deltaHours) => {
    const next = Math.min(9, Math.max(-9, timeOffsetHours + deltaHours))
    setTimeOffsetHours(next)

    const viewer = cesiumViewerRef.current
    if(!viewer || viewer.isDestroyed()) return

    const newDate = new Date(Date.now() + next * 60 * 60 * 1000)
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(newDate)
    updateFnRef.current()
}

  useEffect(() => {
    // cesium에서 발급받은 토큰
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGZlNWIzMy1mYTQxLTQyZmYtODVhMi0wYWZiZmIyYmU1YmUiLCJpZCI6NDQwNTg4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODA2MzIzNTB9.HtQdGVy09SDWyAgtopFoATbUXRys5eGFpBKpAex6oZs';
    
  const viewer = new Cesium.Viewer(viewerRef.current, {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    geocoder: true,
    homeButton: true,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: true,
    creditContainer: document.createElement("div"),
    animation: false,
    timeline: false,
    fullscreenButton: true,
  });
  cesiumViewerRef.current = viewer

  Cesium.createWorldImageryAsync({
    style: Cesium.IonWorldImageryStyle.ROAD
  }).then((imageryProvider) => {
    if (viewer.isDestroyed()) return;
    viewer.imageryLayers.addImageryProvider(imageryProvider);
  });

    // 시각 설정(설정 기준 : 2026.08.17 오후 3시, 한국 UTC+9 기준 6시간 전으로 계산)
    //const targetDate = new Date(2026, 7, 24, 15, 0, 0)
    //viewer.clock.currentTime = Cesium.JulianDate.fromDate(targetDate);
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());
    
    let latestRequestId = 0
    const MAX_HEIGHT_FOR_BUILDINGS = 2000

    function updateBuildingsForCurrentView() {
      if(viewer.isDestroyed()) return
      
      const currentDate = Cesium.JulianDate.toDate(viewer.clock.currentTime)
      const sunPos = getSunPosition(currentDate, 37.480, 126.908)
      console.log('태양 위치:', sunPos)
      const cameraHeight = viewer.camera.positionCartographic.height
      
      // 카메라 뷰어의 고도가 더 높으면 뷰어에 있는 객체들을 remove
      if(cameraHeight > MAX_HEIGHT_FOR_BUILDINGS) {
        viewer.entities.removeAll()
        return
      }
      
      // 카메라의 위치,방향,시야각 정보를 바탕으로 화면에 보이는 지표면이 지리적으로 어느 위치인지 계산해 Cesium.Rectangle객체 반환
      const rectangle = viewer.camera.computeViewRectangle()
      if(!rectangle) return

      // 라디안 > 도 변환
      const west = Cesium.Math.toDegrees(rectangle.west)
      const south = Cesium.Math.toDegrees(rectangle.south)
      const east = Cesium.Math.toDegrees(rectangle.east)
      const north = Cesium.Math.toDegrees(rectangle.north)
      const bbox = `${west},${south},${east},${north}`

      latestRequestId += 1
      const requestId = latestRequestId
      loadWorldBuildings(viewer, bbox, () => requestId === latestRequestId, sunPos)
    } /* updateBuildingsForCurrentView */
    updateFnRef.current = updateBuildingsForCurrentView

    viewer.camera.moveEnd.addEventListener(updateBuildingsForCurrentView)

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(126.908, 37.480, 700),
      // complete: updateBuildingsForCurrentView,
    });

    // 지구 표시 관련
    // viewer.imageryLayers.removeAll();
    viewer.scene.globe.show = true;

    return () => {
      viewer.camera.moveEnd.removeEventListener(updateBuildingsForCurrentView)
      viewer.destroy()
    }
  }, []);
  
return (
  <div className="sim-layout">
    <div className="sim-sidebar-left">
      <a href="/simulation" className="sim-logo">Cesium Scenario AI</a>
      <div className="sim-header-user">
        {user && <p>{user.username}님</p>}
        <button type="button" onClick={handleLogout}>로그아웃</button>
      </div>
      <div className="sim-header-menu">
        </div>
      <div className="sim-toolbox">
        
      </div>
    </div>
 
    <div className="sim-main">
      <div className="sim-viewer-wrapper">
        <div ref={viewerRef} className="sim-viewer" />
        <div className="sim-time-control">
          <span className="sim-time-icon">☀️</span>
          <button type="button" onClick={() => handleTimeStep(-1)}>−</button>
          <span className="sim-time-label">
            {timeOffsetHours > 0 ? `+${timeOffsetHours}` : timeOffsetHours}h
          </span>
          <button type="button" onClick={() => handleTimeStep(1)}>+</button>
        </div>
      </div>
      <div className="current-time">
        <p>🕐현재 시간 : {time.toLocaleString()}</p>
      </div>
    </div>

    <div className="sim-sidebar-right">
      <div className="sim-header-chatbot">
        <div className="sim-chatbot-container">
          <span className="chatbot-icon">🤖</span>
          <h3>ChatBot</h3>
        </div>

        <div className="chat-messages">
          <div className="chat-message chat-message-bot">
            <p>안녕하세요! 무엇을 도와드릴까요?</p>
          </div>
          <div className="chat-message chat-message-user">
            <p>서울역 부근 보여줘</p>
          </div>
          <div className="chat-message chat-message-bot">
            <p>서울역 주변으로 이동했어요.</p>
          </div>
        </div>

        <div className="chatbot-input-area">
          <input type="text" className="chatbot-input" placeholder="메시지를 입력하세요..." value={message} onChange={(e) => setMessage(e.target.value)}/>
          <button type="button" className="chatbot-send-btn" onClick={() => handleCallGemini(message)}>전송</button>
        </div>
      </div>
    </div>
  </div>

)
} /* App */

export default App
