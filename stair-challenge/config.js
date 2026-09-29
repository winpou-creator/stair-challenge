// 이벤트 설정 — 배포 전 이 파일만 수정하면 됩니다.
window.CONFIG = {
  EVENT_NAME: '계단오르기 챌린지',
  EVENT_PERIOD: '2026.09.29 ~ 2026.10.07',

  // Google Apps Script 웹앱 URL (README 참고). 비워두면 "데모 모드"(브라우저 저장소)로 동작합니다.
  API_URL: 'https://script.google.com/macros/s/AKfycbzaZ06vZyB-t-qkZTAbTMzoh4RdEfI_Ccgu173u0dsuJQz5-MmpduqLePsfxY6tPK2l/exec',

  // 데모 모드에서만 쓰는 관리자 키 (실운영은 Apps Script 속성의 ADMIN_KEY 사용)
  DEMO_ADMIN_KEY: '1234',

  // 데모 모드에서만 쓰는 입장키 (접속 주소 뒤에 ?k=demo). 운영은 Apps Script 속성의 ENTRY_KEY 사용
  DEMO_ENTRY_KEY: 'demo',

  // 1개 층 = 몇 걸음으로 볼지 (보통 한 층 18~24계단). 서버(Code.gs)와 동일하게 맞추세요.
  STEPS_PER_FLOOR: 20,

  // 비정상 판정 기준 (데모 모드용. 운영은 Code.gs의 같은 값 사용). 초과해도 저장은 되고 관리자 화면에 표시됨
  MAX_CADENCE: 4.0,
  MAX_FLOORS_PER_SUBMIT: 60,
  MAX_FLOORS_PER_DAY: 150,

  // 걸음 감지 민감도 (m/s²). 낮을수록 민감. 인식이 잘 안 되면 0.8, 오인식이 많으면 1.4 정도로 조정
  STEP_THRESHOLD: 1.0,

  // 계열사 목록 — 계열사 랭킹의 기준 (실제 계열사명으로 수정하세요)
  DEPARTMENTS: ['KBI그룹', 'KBI건설', 'KBI메탈', 'KBI코스모링크', 'KBI알로이', 'KBI동양철관', 'KBI유상테크', '합섬상사'],
};
