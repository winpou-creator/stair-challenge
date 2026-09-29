/**
 * 계단오르기 챌린지 백엔드 (Google Apps Script + Google Sheets)
 * 배포: README.md 참고. 스크립트 속성(Script Properties)에 ADMIN_KEY 를 반드시 설정하세요.
 */
const STEPS_PER_FLOOR = 20;          // config.js 와 동일하게
// 아래 3개는 "비정상 판정" 기준입니다. 초과해도 기록은 저장되고 flags 열에 사유가 남습니다.
const MAX_CADENCE = 4.0;             // 걸음/초 상한 (흔들기 등 의심)
const MAX_FLOORS_PER_SUBMIT = 60;    // 1회 저장 최대 층
const MAX_FLOORS_PER_DAY = 150;      // 1일 최대 층
const EVENT_START = '2026-09-29';    // 기록 인정 기간 (양끝 포함) — config.js의 EVENT_PERIOD와 맞추세요
const EVENT_END = '2026-10-07';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = { register, submit, me, ranking, admin_list, admin_delete, admin_reset }[req.action];
    if (!fn) throw new Error('알 수 없는 요청');
    return out({ ok: true, data: fn(req) });
  } catch (err) {
    return out({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function sheet(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); }
  return sh;
}
const users = () => sheet('참가자', ['userId', 'name', 'dept', 'createdAt']);
const RECORD_HEADER = ['id', 'ts', 'date', 'userId', 'name', 'dept', 'steps', 'floors', 'durationSec', 'flags'];
const records = () => {
  const sh = sheet('기록', RECORD_HEADER);
  // 이전 버전 시트에는 flags 열이 없으므로 헤더를 보강
  if (sh.getLastColumn() < RECORD_HEADER.length) sh.getRange(1, RECORD_HEADER.length).setValue('flags');
  return sh;
};
const rows = (sh) => { const v = sh.getDataRange().getValues(); const h = v.shift(); return v.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const today = () => Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
const dateStr = (d) => (d instanceof Date ? Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') : String(d));

// ---- 입장 통제: QR에 담긴 입장키(ENTRY_KEY) + 로그인마다 발급되는 1회용 세션 ----
function requireKey(r) {
  const key = PropertiesService.getScriptProperties().getProperty('ENTRY_KEY');
  if (!key) throw new Error('서버에 ENTRY_KEY가 설정되지 않았습니다.');
  if (r.key !== key) throw new Error('계단 QR 코드를 스캔해서 접속해 주세요.');
}
function issueToken(userId) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify({ userId: String(userId), at: Date.now() }), 21600);
  return token;
}
function peekToken(token, userId) {
  const raw = token && CacheService.getScriptCache().get('sess:' + token);
  const s = raw && JSON.parse(raw);
  if (!s || s.userId !== String(userId)) throw new Error('로그인이 만료되었습니다. QR 코드를 다시 스캔해 로그인해 주세요.');
  return s;
}

function register(r) {
  requireKey(r);
  const userId = String(r.userId || '').trim(), name = String(r.name || '').trim(), dept = String(r.dept || '').trim();
  if (!userId || !name || !dept) throw new Error('입력값이 부족합니다.');
  const sh = users();
  const list = rows(sh);
  const idx = list.findIndex((u) => String(u.userId) === userId);
  if (idx >= 0) {
    if (list[idx].name !== name) throw new Error('이미 다른 이름으로 등록된 사번입니다.');
    return { userId, name, dept, token: issueToken(userId) }; // 재로그인 허용
  }
  sh.appendRow([userId, name, dept, new Date().toISOString()]);
  return { userId, name, dept, token: issueToken(userId) };
}

function submit(r) {
  requireKey(r);
  const sess = peekToken(r.token, r.userId);
  const d = today();
  if (d < EVENT_START || d > EVENT_END) throw new Error('이벤트 기간이 아닙니다.');
  const u = rows(users()).find((x) => String(x.userId) === String(r.userId));
  if (!u) throw new Error('참가 신청이 필요합니다.');
  const steps = Math.floor(Number(r.steps)), dur = Math.floor(Number(r.durationSec));
  if (!(steps > 0) || !(dur > 0)) throw new Error('잘못된 기록입니다.');
  const floors = Math.floor(steps / STEPS_PER_FLOOR);
  const todayFloors = rows(records())
    .filter((x) => String(x.userId) === String(r.userId) && dateStr(x.date) === d)
    .reduce((s, x) => s + Number(x.floors), 0);
  // 비정상 판정: 저장은 하되 사유를 flags 열에 기록 (관리자 화면에서 확인)
  const flags = [];
  const cadence = steps / dur;
  if (cadence > MAX_CADENCE) flags.push('고속걸음(' + cadence.toFixed(1) + '걸음/초)');
  if (floors > MAX_FLOORS_PER_SUBMIT) flags.push('1회상한초과(' + floors + '층)');
  if (todayFloors + floors > MAX_FLOORS_PER_DAY) flags.push('일일상한초과(누적 ' + (todayFloors + floors) + '층)');
  const elapsed = Math.round((Date.now() - sess.at) / 1000); // 로그인 후 서버가 잰 시간
  if (dur > elapsed + 10) flags.push('시간불일치(측정 ' + dur + '초 > 로그인 후 ' + elapsed + '초)');
  records().appendRow([Date.now(), new Date().toISOString(), d, u.userId, u.name, u.dept, steps, floors, dur, flags.join(' / ')]);
  CacheService.getScriptCache().remove('sess:' + r.token); // 세션 소진: 저장 후에는 QR 재스캔 필요
  return { floors };
}

function me(r) {
  requireKey(r);
  const d = today();
  const mine = rows(records()).filter((x) => String(x.userId) === String(r.userId));
  return {
    floors: mine.reduce((s, x) => s + Number(x.floors), 0),
    todayFloors: mine.filter((x) => dateStr(x.date) === d).reduce((s, x) => s + Number(x.floors), 0),
  };
}

function ranking(r) {
  requireKey(r);
  const us = rows(users()), recs = rows(records());
  const per = {};
  recs.forEach((x) => {
    const p = (per[x.userId] = per[x.userId] || { userId: String(x.userId), name: x.name, dept: x.dept, floors: 0, steps: 0 });
    p.floors += Number(x.floors); p.steps += Number(x.steps);
  });
  const individual = Object.values(per).sort((a, b) => b.floors - a.floors || b.steps - a.steps);
  individual.forEach((p, i) => (p.rank = i + 1));
  const teams = {};
  us.forEach((u) => { (teams[u.dept] = teams[u.dept] || { dept: u.dept, floors: 0, members: 0 }).members++; });
  individual.forEach((p) => { if (teams[p.dept]) teams[p.dept].floors += p.floors; });
  const team = Object.values(teams)
    .map((t) => Object.assign(t, { avg: Math.round((t.floors / t.members) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg);
  team.forEach((t, i) => (t.rank = i + 1));
  // 개인정보 최소화: 사번은 응답에서 제거
  individual.forEach((p) => delete p.userId);
  return { individual, team };
}

function requireAdmin(r) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || r.adminKey !== key) throw new Error('관리자 키가 올바르지 않습니다.');
}
function admin_list(r) {
  requireAdmin(r);
  return { users: rows(users()), records: rows(records()).reverse() };
}
// scope: 'records' = 기록만 초기화, 'all' = 기록 + 참가자 모두 초기화 (헤더 행은 유지)
function admin_reset(r) {
  requireAdmin(r);
  const targets = r.scope === 'all' ? [records(), users()] : [records()];
  targets.forEach((sh) => {
    const n = sh.getLastRow() - 1;
    if (n > 0) sh.deleteRows(2, n);
  });
  return {};
}
function admin_delete(r) {
  requireAdmin(r);
  const sh = records();
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(r.id)) { sh.deleteRow(i + 1); break; }
  return {};
}
