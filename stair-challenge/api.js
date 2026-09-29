// 백엔드 호출 계층: API_URL이 있으면 Apps Script, 없으면 브라우저 저장소(데모)
(function () {
  const KEY = 'stair_demo_db';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"users":{},"records":[]}');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const ss = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const today = () => new Date().toISOString().slice(0, 10);

  function ranking(db) {
    const per = {};
    db.records.forEach((r) => {
      const p = (per[r.userId] = per[r.userId] || { name: r.name, dept: r.dept, floors: 0, steps: 0 });
      p.floors += r.floors;
      p.steps += r.steps;
    });
    const individual = Object.values(per).sort((a, b) => b.floors - a.floors || b.steps - a.steps);
    individual.forEach((p, i) => (p.rank = i + 1));
    const teams = {};
    Object.values(db.users).forEach((u) => {
      (teams[u.dept] = teams[u.dept] || { dept: u.dept, floors: 0, members: 0 }).members++;
    });
    individual.forEach((p) => {
      (teams[p.dept] = teams[p.dept] || { dept: p.dept, floors: 0, members: 0 }).floors += p.floors;
    });
    const team = Object.values(teams)
      .map((t) => ({ ...t, avg: t.members ? Math.round((t.floors / t.members) * 10) / 10 : 0 }))
      .sort((a, b) => b.avg - a.avg);
    team.forEach((t, i) => (t.rank = i + 1));
    return { individual, team };
  }

  const demo = {
    register({ userId, name, dept }) {
      const db = load();
      db.users[userId] = { userId, name, dept, createdAt: new Date().toISOString() };
      const token = 't' + Date.now() + Math.random().toString(36).slice(2);
      (db.sessions = db.sessions || {})[token] = { userId, at: Date.now() };
      save(db);
      return { ...db.users[userId], token };
    },
    submit({ userId, steps, durationSec, token }) {
      const db = load();
      const sess = (db.sessions || {})[token];
      if (!sess || sess.userId !== userId) throw new Error('로그인이 만료되었습니다. QR 코드를 다시 스캔해 로그인해 주세요.');
      const u = db.users[userId];
      if (!u) throw new Error('참가 신청이 필요합니다.');
      const floors = Math.floor(steps / CONFIG.STEPS_PER_FLOOR);
      const todayFloors = db.records
        .filter((r) => r.userId === userId && r.date === today())
        .reduce((s, r) => s + r.floors, 0);
      const flags = [];
      const cadence = steps / durationSec;
      if (cadence > CONFIG.MAX_CADENCE) flags.push('고속걸음(' + cadence.toFixed(1) + '걸음/초)');
      if (floors > CONFIG.MAX_FLOORS_PER_SUBMIT) flags.push('1회상한초과(' + floors + '층)');
      if (todayFloors + floors > CONFIG.MAX_FLOORS_PER_DAY) flags.push('일일상한초과(누적 ' + (todayFloors + floors) + '층)');
      const elapsed = Math.round((Date.now() - sess.at) / 1000);
      if (durationSec > elapsed + 10) flags.push('시간불일치(측정 ' + durationSec + '초 > 로그인 후 ' + elapsed + '초)');
      delete db.sessions[token]; // 세션 소진
      db.records.push({
        id: Date.now(), ts: new Date().toISOString(), date: today(),
        userId, name: u.name, dept: u.dept, steps, floors, durationSec, flags: flags.join(' / '),
      });
      save(db);
      return { floors };
    },
    me({ userId }) {
      const db = load();
      const mine = db.records.filter((r) => r.userId === userId);
      return {
        floors: mine.reduce((s, r) => s + r.floors, 0),
        todayFloors: mine.filter((r) => r.date === today()).reduce((s, r) => s + r.floors, 0),
      };
    },
    ranking: () => ranking(load()),
    admin_list({ adminKey }) {
      if (adminKey !== CONFIG.DEMO_ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
      const db = load();
      return { users: Object.values(db.users), records: db.records.slice().reverse() };
    },
    admin_reset({ adminKey, scope }) {
      if (adminKey !== CONFIG.DEMO_ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
      const db = load();
      db.records = [];
      if (scope === 'all') db.users = {};
      save(db);
      return {};
    },
    admin_delete({ adminKey, id }) {
      if (adminKey !== CONFIG.DEMO_ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
      const db = load();
      db.records = db.records.filter((r) => String(r.id) !== String(id));
      save(db);
      return {};
    },
  };

  window.API = {
    isDemo: !CONFIG.API_URL,
    async call(action, payload = {}) {
      if (!action.startsWith('admin_')) { // 참가자 요청에는 QR로 받은 입장키와 로그인 세션을 자동 첨부
        payload = { ...payload, key: ss('stair_key'), token: ss('stair_token') };
      }
      if (!CONFIG.API_URL) {
        if (!action.startsWith('admin_') && payload.key !== CONFIG.DEMO_ENTRY_KEY) {
          throw new Error('계단 QR 코드를 스캔해서 접속해 주세요.');
        }
        return demo[action](payload);
      }
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 회피
        body: JSON.stringify({ action, ...payload }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || '서버 오류');
      return j.data;
    },
  };
})();
