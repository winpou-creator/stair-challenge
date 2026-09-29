(function () {
  const $ = (id) => document.getElementById(id);
  const USER_KEY = 'stair_user';
  const SESSION_KEY = 'stair_session';
  const MIN_STEP_INTERVAL = 280; // ms, 초당 약 3.5걸음 이상은 걸음으로 세지 않음
  let user = null; // 자동 로그인 없음: 앱을 열 때마다 계열사·이름을 입력해 로그인

  $('evName').textContent = CONFIG.EVENT_NAME;
  $('evPeriod').textContent = CONFIG.EVENT_PERIOD + (API.isDemo ? '  (데모 모드)' : '');
  CONFIG.DEPARTMENTS.forEach((d) => $('dept').add(new Option(d, d)));

  // ---------- 화면 전환 ----------
  function show(v) {
    ['gate', 'done', 'join', 'climb', 'rank'].forEach((k) => $('v-' + k).classList.toggle('hidden', k !== v));
    $('nav').classList.toggle('hidden', v === 'join' || v === 'gate' || v === 'done');
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    if (v === 'rank') loadRank();
    if (v === 'climb') loadMine();
  }
  document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => show(b.dataset.v)));

  // ---------- 참가 신청 ----------
  $('btnJoin').onclick = async () => {
    const name = $('name').value.trim().replace(/\s+/g, ' '), dept = $('dept').value;
    const userId = dept + '|' + name; // 로그인 ID = 계열사 + 이름
    const m = $('joinMsg');
    if (!name) { m.className = 'msg err'; m.textContent = '이름을 입력해 주세요.'; return; }
    $('btnJoin').disabled = true;
    try {
      const reg = await API.call('register', { userId, name, dept }); // 이미 있으면 로그인으로 처리
      sessionStorage.setItem('stair_token', reg.token); // 이번 로그인 전용 1회용 세션
      user = { userId, name, dept };
      enterApp();
    } catch (e) { m.className = 'msg err'; m.textContent = e.message; }
    $('btnJoin').disabled = false;
  };

  function enterApp() {
    $('who').textContent = `${user.name} · ${user.dept}`;
    show('climb');
    resumeSession();
  }

  // ---------- 걸음 감지 ----------
  const S = { running: false, steps: 0, startedAt: 0, lastStep: 0, g: null, s: 0, p1: 0, p2: 0, timer: null, wake: null };

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const m = Math.hypot(a.x, a.y, a.z);
    S.g = S.g == null ? m : S.g * 0.9 + m * 0.1; // 중력 성분 추정
    const cur = S.s * 0.6 + (m - S.g) * 0.4;      // 고역통과 + 평활화
    const now = performance.now();
    // p1이 지역 최대점이고 임계값을 넘으면 1걸음
    if (S.p1 > CONFIG.STEP_THRESHOLD && S.p1 > S.p2 && S.p1 >= cur && now - S.lastStep > MIN_STEP_INTERVAL) {
      S.lastStep = now;
      S.steps++;
      persist();
      render();
    }
    S.p2 = S.p1; S.p1 = cur; S.s = cur;
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function render() {
    const sec = S.startedAt ? Math.round((Date.now() - S.startedAt) / 1000) : 0;
    $('steps').textContent = S.steps;
    $('floors').textContent = Math.floor(S.steps / CONFIG.STEPS_PER_FLOOR);
    $('time').textContent = fmt(sec);
    $('cad').textContent = sec ? (S.steps / sec).toFixed(1) : '0.0';
  }
  function persist() {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.userId, steps: S.steps, startedAt: S.startedAt }));
  }
  function setClimbMsg(t, cls) { $('climbMsg').className = 'msg ' + (cls || ''); $('climbMsg').innerHTML = t; }

  async function startSensors() {
    if (typeof DeviceMotionEvent === 'undefined') throw new Error('이 기기는 모션 센서를 지원하지 않습니다.');
    if (typeof DeviceMotionEvent.requestPermission === 'function') { // iOS 13+
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') throw new Error('모션 센서 권한이 거부되었습니다. 설정 > Safari > 모션 및 방향 접근을 허용해 주세요.');
    }
    window.addEventListener('devicemotion', onMotion);
    try { S.wake = await navigator.wakeLock?.request('screen'); } catch (_) {}
  }

  function begin(resume) {
    S.running = true;
    if (!resume) { S.steps = 0; S.startedAt = Date.now(); }
    S.g = null; S.s = S.p1 = S.p2 = 0;
    persist(); render();
    $('btnStart').classList.add('hidden');
    $('btnStop').classList.remove('hidden');
    S.timer = setInterval(render, 1000);
    setClimbMsg('측정 중입니다. 화면을 끄지 마세요.');
  }

  $('btnStart').onclick = async () => {
    if (!window.isSecureContext) return setClimbMsg('센서는 HTTPS 주소에서만 동작합니다.', 'err');
    try { await startSensors(); begin(false); }
    catch (e) { setClimbMsg(e.message, 'err'); }
  };

  async function resumeSession() {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!saved || S.running || saved.userId !== user.userId) return; // 본인 로그인일 때만 이어서 측정
    S.steps = saved.steps; S.startedAt = saved.startedAt; render();
    $('btnStart').textContent = '▶ 이어서 측정';
    $('btnStart').onclick = async () => {
      try { await startSensors(); begin(true); } catch (e) { setClimbMsg(e.message, 'err'); }
    };
    setClimbMsg('저장되지 않은 이전 측정이 있습니다. 이어서 측정하거나 종료해 저장하세요.');
    $('btnStop').classList.remove('hidden');
  }

  $('btnStop').onclick = async () => {
    window.removeEventListener('devicemotion', onMotion);
    clearInterval(S.timer); S.running = false;
    try { S.wake?.release(); } catch (_) {}
    const durationSec = Math.max(1, Math.round((Date.now() - S.startedAt) / 1000));
    const floors = Math.floor(S.steps / CONFIG.STEPS_PER_FLOOR);
    if (S.steps === 0) {
      resetSession();
      return setClimbMsg('기록된 걸음이 없어 저장하지 않았습니다.');
    }
    $('btnStop').disabled = true;
    try {
      const r = await API.call('submit', { userId: user.userId, steps: S.steps, durationSec });
      resetSession();
      logout(r.floors ?? floors); // 저장하면 로그아웃: QR을 다시 스캔해야 재접속 가능
      return;
    } catch (e) {
      setClimbMsg('저장 실패: ' + e.message + ' — 다시 눌러 재시도하세요. (기록은 기기에 보관 중)', 'err');
    }
    $('btnStop').disabled = false;
  };

  function resetSession() {
    localStorage.removeItem(SESSION_KEY);
    $('btnStop').disabled = false;
    S.steps = 0; S.startedAt = 0; render();
    $('btnStart').textContent = '▶ 오르기 시작';
    $('btnStart').onclick = $('btnStart').__orig;
    $('btnStart').classList.remove('hidden');
    $('btnStop').classList.add('hidden');
  }
  $('btnStart').__orig = $('btnStart').onclick;

  // ---------- 내 기록 / 랭킹 ----------
  async function loadMine() {
    try {
      const me = await API.call('me', { userId: user.userId });
      $('myTotal').textContent = me.floors; $('myToday').textContent = me.todayFloors;
      const r = await API.call('ranking');
      const idx = r.individual.find((p) => p.userId === user.userId || (p.name === user.name && p.dept === user.dept));
      $('myRank').textContent = idx ? idx.rank + '위' : '-';
    } catch (_) {}
  }

  let mode = 'ind';
  $('tabInd').onclick = () => { mode = 'ind'; setTabs(); loadRank(); };
  $('tabTeam').onclick = () => { mode = 'team'; setTabs(); loadRank(); };
  $('btnRefresh').onclick = loadRank;
  function setTabs() {
    $('tabInd').classList.toggle('on', mode === 'ind');
    $('tabTeam').classList.toggle('on', mode === 'team');
  }
  const medal = (n) => ['🥇', '🥈', '🥉'][n - 1] || n;

  function row(rank, title, sub, val, me) {
    const d = document.createElement('div');
    d.className = 'rank-row' + (me ? ' me' : '');
    d.innerHTML = '<div class="rank-no"></div><div class="rank-info"><b></b><br><small></small></div><div class="rank-val"></div>';
    d.children[0].textContent = medal(rank);
    d.querySelector('b').textContent = title;
    d.querySelector('small').textContent = sub;
    d.children[2].textContent = val;
    return d;
  }
  async function loadRank() {
    const box = $('rankList');
    box.textContent = '불러오는 중…';
    try {
      const r = await API.call('ranking');
      box.textContent = '';
      if (mode === 'ind') {
        if (!r.individual.length) box.textContent = '아직 기록이 없습니다.';
        r.individual.slice(0, 50).forEach((p) =>
          box.append(row(p.rank, p.name, p.dept + ' · ' + p.steps.toLocaleString() + '걸음', p.floors + '층',
            user && p.name === user.name && p.dept === user.dept)));
      } else {
        if (!r.team.length) box.textContent = '아직 기록이 없습니다.';
        r.team.forEach((t) =>
          box.append(row(t.rank, t.dept, `참가 ${t.members}명 · 합계 ${t.floors}층`, '평균 ' + t.avg + '층',
            user && t.dept === user.dept)));
      }
    } catch (e) { box.textContent = '불러오기 실패: ' + e.message; }
  }

  function logout(floors) {
    sessionStorage.removeItem('stair_key');
    sessionStorage.removeItem('stair_token');
    user = null;
    $('name').value = '';
    $('doneFloors').textContent = floors;
    show('done');
  }

  // ---------- 시작 ----------
  localStorage.removeItem(USER_KEY); // 이전 버전이 저장해 둔 자동 로그인 정보 삭제
  // QR 주소(?k=입장키)로 들어오면 키를 이 탭에만 보관하고 주소창에서는 지움
  const qk = new URLSearchParams(location.search).get('k');
  if (qk) {
    sessionStorage.setItem('stair_key', qk);
    history.replaceState(null, '', location.pathname);
  }
  show(sessionStorage.getItem('stair_key') ? 'join' : 'gate');

  // 앱으로 다시 돌아올 때마다 기록 새로고침
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user && !S.running) loadMine();
  });
})();
