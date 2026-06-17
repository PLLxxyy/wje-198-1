import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const TEST_DB_PATH = path.join(dataDir, 'test-station.db');
const TEST_PORT = 3998;
const BASE_URL = `http://localhost:${TEST_PORT}`;

if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

process.env.TEST_DB_PATH = TEST_DB_PATH;

(async () => {
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const authRoutes = (await import('./routes/auth.js')).default;
  const packageRoutes = (await import('./routes/packages.js')).default;
  const statsRoutes = (await import('./routes/stats.js')).default;
  const { authMiddleware, signToken, hashPassword } = await import('./auth.js');
  const { default: db, initDB } = await import('./db.js');

  const app = express();
  app.use(cors());
  app.use(express.json());

  initDB();

  app.use('/api/auth', authRoutes);
  app.use('/api/packages', authMiddleware, packageRoutes);
  app.use('/api/stats', authMiddleware, statsRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const server = app.listen(TEST_PORT);

  function formatLocalDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(10, 0, 0, 0);
    return formatLocalDate(d);
  }

  async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function apiCall(method: string, path: string, token?: string, body?: any): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data };
  }

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${testName}`);
    } else {
      failed++;
      console.log(`  ✗ ${testName}`);
      if (detail) console.log(`    ${detail}`);
    }
  }

  try {
    await wait(300);

    const health = await apiCall('GET', '/api/health');
    if (health.status !== 200 || health.data?.status !== 'ok') {
      console.error('服务器启动失败');
      process.exit(1);
    }

    const insertUser = db.prepare(
      'INSERT INTO users (username, password, name, role, phone) VALUES (?, ?, ?, ?, ?)'
    );
    const courierId = insertUser.run('testcourier', hashPassword('test123'), '测试快递员', 'courier', '13800000001').lastInsertRowid as number;
    const recipientId = insertUser.run('testuser', hashPassword('test123'), '测试用户', 'recipient', '13900000001').lastInsertRowid as number;

    const courierToken = signToken({ userId: courierId, role: 'courier', username: 'testcourier' });

    const insertPkg = db.prepare(
      `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at, picked_up_at, picked_up_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const todayPendingId = insertPkg.run(
      'TEST001', '13900000001', '原姓名A', '111111', 'pending', courierId,
      formatLocalDate(new Date()), null, null
    ).lastInsertRowid as number;

    const yesterdayPendingId = insertPkg.run(
      'TEST002', '13900000002', '昨天的包裹', '222222', 'pending', courierId,
      daysAgo(1), null, null
    ).lastInsertRowid as number;

    const todayPickedId = insertPkg.run(
      'TEST003', '13900000003', '已取件的包裹', '333333', 'picked_up', courierId,
      formatLocalDate(new Date()), formatLocalDate(new Date()), recipientId
    ).lastInsertRowid as number;

    console.log('\n========================================');
    console.log('  编辑收件信息 - HTTP API 自动化验证');
    console.log('========================================\n');

    console.log('【前置检查】健康检查和登录获取 Token');
    assert(health.status === 200, '服务器健康检查通过');
    assert(courierToken.length > 0, '快递员 Token 生成成功');

    console.log('\n【场景 1】今日入库 + 待取件 → 可以编辑');
    {
      const res = await apiCall('PUT', `/api/packages/${todayPendingId}`, courierToken, {
        recipient_phone: '13999999999',
        recipient_name: '新姓名A',
      });
      assert(res.status === 200, `HTTP 状态码为 200（实际: ${res.status}）`, res.data?.error);
      assert(res.data?.message?.includes('成功') === true, '响应信息包含修改成功', res.data?.message);
      assert(res.data?.package?.recipient_phone === '13999999999', '手机号已更新', `实际: ${res.data?.package?.recipient_phone}`);
      assert(res.data?.package?.recipient_name === '新姓名A', '姓名已更新', `实际: ${res.data?.package?.recipient_name}`);
      assert(res.data?.package?.pickup_code === '111111', '取件码保持不变', `实际: ${res.data?.package?.pickup_code}`);
      assert(res.data?.package?.status === 'pending', '状态保持待取件', `实际: ${res.data?.package?.status}`);
      const dbPkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(todayPendingId) as any;
      assert(dbPkg.recipient_phone === '13999999999', '数据库中手机号已同步更新');
      assert(dbPkg.recipient_name === '新姓名A', '数据库中姓名已同步更新');
    }

    console.log('\n【场景 2】非今日入库 + 待取件 → 不能编辑');
    {
      const res = await apiCall('PUT', `/api/packages/${yesterdayPendingId}`, courierToken, {
        recipient_phone: '13988888888',
        recipient_name: '修改失败B',
      });
      assert(res.status === 400, `HTTP 状态码为 400（实际: ${res.status}）`, res.data?.error);
      assert(res.data?.error?.includes('今日') === true || res.data?.error?.includes('今天') === true,
        '错误信息提示非今日入库限制', `实际: ${res.data?.error}`);
      const dbPkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(yesterdayPendingId) as any;
      assert(dbPkg.recipient_phone === '13900000002', '数据库中手机号未被修改', `实际: ${dbPkg.recipient_phone}`);
      assert(dbPkg.recipient_name === '昨天的包裹', '数据库中姓名未被修改', `实际: ${dbPkg.recipient_name}`);
    }

    console.log('\n【场景 3】今日入库 + 已取件 → 不能编辑');
    {
      const res = await apiCall('PUT', `/api/packages/${todayPickedId}`, courierToken, {
        recipient_phone: '13977777777',
        recipient_name: '修改失败C',
      });
      assert(res.status === 400, `HTTP 状态码为 400（实际: ${res.status}）`, res.data?.error);
      assert(res.data?.error?.includes('待取件') === true,
        '错误信息提示仅待取件可改', `实际: ${res.data?.error}`);
      const dbPkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(todayPickedId) as any;
      assert(dbPkg.recipient_phone === '13900000003', '数据库中手机号未被修改', `实际: ${dbPkg.recipient_phone}`);
      assert(dbPkg.recipient_name === '已取件的包裹', '数据库中姓名未被修改', `实际: ${dbPkg.recipient_name}`);
      assert(dbPkg.status === 'picked_up', '状态保持已取件', `实际: ${dbPkg.status}`);
    }

    console.log('\n【额外安全校验】参数校验和权限校验');
    {
      const resNoPhone = await apiCall('PUT', `/api/packages/${todayPendingId}`, courierToken, {
        recipient_name: '只有姓名',
      });
      assert(resNoPhone.status === 400, '缺少手机号返回 400', resNoPhone.data?.error);

      const resNoName = await apiCall('PUT', `/api/packages/${todayPendingId}`, courierToken, {
        recipient_phone: '13966666666',
      });
      assert(resNoName.status === 400, '缺少姓名返回 400', resNoName.data?.error);

      const resNoAuth = await apiCall('PUT', `/api/packages/${todayPendingId}`, undefined, {
        recipient_phone: '13955555555',
        recipient_name: '未授权修改',
      });
      assert(resNoAuth.status === 401, '未登录返回 401', resNoAuth.data?.error);
    }

    console.log('\n========================================');
    console.log(`  测试结果: 通过 ${passed} / ${passed + failed}`);
    console.log('========================================\n');

    server.close();
    db.close();

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('测试执行出错:', err);
    try { server.close(); } catch {}
    try { db.close(); } catch {}
    process.exit(1);
  }
})();
