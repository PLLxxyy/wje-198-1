import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const TEST_DB_PATH = path.join(dataDir, 'test-station.db');
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

const db = new Database(TEST_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('courier','recipient','admin')),
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_no TEXT UNIQUE NOT NULL,
    recipient_phone TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    pickup_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','picked_up','expired')),
    entered_by INTEGER NOT NULL,
    entered_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    picked_up_at TEXT,
    picked_up_by INTEGER,
    FOREIGN KEY (entered_by) REFERENCES users(id),
    FOREIGN KEY (picked_up_by) REFERENCES users(id)
  );
`);

const hash = (pw: string) => bcrypt.hashSync(pw, 10);
const courierId = db.prepare(
  'INSERT INTO users (username, password, name, role, phone) VALUES (?, ?, ?, ?, ?)'
).run('testcourier', hash('test123'), '测试快递员', 'courier', '13800000001').lastInsertRowid as number;

const recipientId = db.prepare(
  'INSERT INTO users (username, password, name, role, phone) VALUES (?, ?, ?, ?, ?)'
).run('testuser', hash('test123'), '测试用户', 'recipient', '13900000001').lastInsertRowid as number;

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

function editPackage(pkgId: number, phone: string, name: string): { success: boolean; error?: string } {
  try {
    const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(pkgId) as any;
    if (!pkg) {
      return { success: false, error: '未找到该快递' };
    }
    if (pkg.status !== 'pending') {
      return { success: false, error: '仅待取件的快递可以修改收件信息' };
    }
    const isToday = db.prepare(
      "SELECT 1 FROM packages WHERE id = ? AND date(entered_at) = date('now','localtime')"
    ).get(pkgId);
    if (!isToday) {
      return { success: false, error: '仅今日入库的快递可以修改收件信息' };
    }
    db.prepare(
      'UPDATE packages SET recipient_phone = ?, recipient_name = ? WHERE id = ?'
    ).run(phone, name, pkgId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
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

console.log('\n========================================');
console.log('  编辑收件信息 - 自动化验证');
console.log('========================================\n');

const todayPkgId = db.prepare(
  `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at)
   VALUES (?, ?, ?, ?, 'pending', ?, datetime('now','localtime'))`
).run('TEST001', '13900000001', '原姓名', '123456', courierId).lastInsertRowid as number;

const yesterdayPkgId = db.prepare(
  `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at)
   VALUES (?, ?, ?, ?, 'pending', ?, ?)`
).run('TEST002', '13900000002', '昨天的包裹', '222222', courierId, daysAgo(1)).lastInsertRowid as number;

const pickedUpPkgId = db.prepare(
  `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at, picked_up_at, picked_up_by)
   VALUES (?, ?, ?, ?, 'picked_up', ?, datetime('now','localtime'), datetime('now','localtime'), ?)`
).run('TEST003', '13900000003', '已取件的包裹', '333333', courierId, recipientId).lastInsertRowid as number;

const twoDaysAgoPkgId = db.prepare(
  `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at)
   VALUES (?, ?, ?, ?, 'pending', ?, ?)`
).run('TEST004', '13900000004', '两天前的包裹', '444444', courierId, daysAgo(2)).lastInsertRowid as number;

console.log('【测试用例 1】今日入库且待取件的包裹 - 可以编辑');
{
  const result = editPackage(todayPkgId, '13999999999', '新姓名');
  assert(result.success === true, '修改成功', result.error);
  const updated = db.prepare('SELECT * FROM packages WHERE id = ?').get(todayPkgId) as any;
  assert(updated.recipient_phone === '13999999999', '手机号已更新', `实际: ${updated.recipient_phone}`);
  assert(updated.recipient_name === '新姓名', '姓名已更新', `实际: ${updated.recipient_name}`);
  assert(updated.pickup_code === '123456', '取件码保持不变', `实际: ${updated.pickup_code}`);
  assert(updated.status === 'pending', '状态保持待取件', `实际: ${updated.status}`);
}

console.log('\n【测试用例 2】昨天入库且待取件的包裹 - 不能编辑');
{
  const result = editPackage(yesterdayPkgId, '13988888888', '修改失败');
  assert(result.success === false, '修改被拒绝', result.error);
  assert(result.error?.includes('今日') === true || result.error?.includes('今天') === true, '错误信息提示非今日', `实际: ${result.error}`);
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(yesterdayPkgId) as any;
  assert(pkg.recipient_phone === '13900000002', '手机号未被修改', `实际: ${pkg.recipient_phone}`);
  assert(pkg.recipient_name === '昨天的包裹', '姓名未被修改', `实际: ${pkg.recipient_name}`);
}

console.log('\n【测试用例 3】今日入库但已取件的包裹 - 不能编辑');
{
  const result = editPackage(pickedUpPkgId, '13977777777', '已取件修改');
  assert(result.success === false, '修改被拒绝', result.error);
  assert(result.error?.includes('待取件') === true, '错误信息提示仅待取件可改', `实际: ${result.error}`);
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(pickedUpPkgId) as any;
  assert(pkg.recipient_phone === '13900000003', '手机号未被修改', `实际: ${pkg.recipient_phone}`);
  assert(pkg.recipient_name === '已取件的包裹', '姓名未被修改', `实际: ${pkg.recipient_name}`);
}

console.log('\n【测试用例 4】两天前入库的待取件包裹 - 不能编辑');
{
  const result = editPackage(twoDaysAgoPkgId, '13966666666', '两天前修改');
  assert(result.success === false, '修改被拒绝', result.error);
  assert(result.error?.includes('今日') === true || result.error?.includes('今天') === true, '错误信息提示非今日', `实际: ${result.error}`);
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(twoDaysAgoPkgId) as any;
  assert(pkg.recipient_phone === '13900000004', '手机号未被修改', `实际: ${pkg.recipient_phone}`);
  assert(pkg.recipient_name === '两天前的包裹', '姓名未被修改', `实际: ${pkg.recipient_name}`);
}

console.log('\n【测试用例 5】日期校验边界 - 昨天 23:59:59 入库的包裹');
{
  const yesterdayLateId = db.prepare(
    `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run('TEST005', '13900000005', '昨晚的包裹', '555555', courierId, daysAgo(1).replace('10:00:00', '23:59:59')).lastInsertRowid as number;

  const result = editPackage(yesterdayLateId, '13955555555', '昨晚修改');
  assert(result.success === false, '修改被拒绝（属于昨天）', result.error);
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(yesterdayLateId) as any;
  assert(pkg.recipient_name === '昨晚的包裹', '姓名未被修改', `实际: ${pkg.recipient_name}`);
}

console.log('\n【测试用例 6】日期校验边界 - 今天 00:00:01 入库的包裹');
{
  const todayEarly = new Date();
  todayEarly.setHours(0, 0, 1, 0);
  const todayEarlyStr = formatLocalDate(todayEarly);
  const todayEarlyId = db.prepare(
    `INSERT INTO packages (tracking_no, recipient_phone, recipient_name, pickup_code, status, entered_by, entered_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run('TEST006', '13900000006', '凌晨的包裹', '666666', courierId, todayEarlyStr).lastInsertRowid as number;

  const result = editPackage(todayEarlyId, '13944444444', '凌晨修改成功');
  assert(result.success === true, '修改成功（属于今天）', result.error);
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(todayEarlyId) as any;
  assert(pkg.recipient_name === '凌晨修改成功', '姓名已更新', `实际: ${pkg.recipient_name}`);
}

console.log('\n========================================');
console.log(`  测试结果: 通过 ${passed} / ${passed + failed}`);
console.log('========================================');

db.close();

if (failed > 0) {
  process.exit(1);
}
