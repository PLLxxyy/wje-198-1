import { useState, useEffect, FormEvent } from 'react';
import { api } from '../api';

interface Package {
  id: number;
  tracking_no: string;
  recipient_phone: string;
  recipient_name: string;
  pickup_code: string;
  status: string;
  entered_at: string;
  entered_by_name?: string;
}

export default function CourierPage() {
  const [tab, setTab] = useState<'enter' | 'list'>('enter');
  const [trackingNo, setTrackingNo] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Package | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editName, setEditName] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editResult, setEditResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (tab === 'list') loadToday();
  }, [tab]);

  const loadToday = async () => {
    setListLoading(true);
    try {
      const data = await api.getTodayPackages();
      setPackages(data.packages);
    } catch (err: any) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  const handleEdit = (pkg: Package) => {
    setEditingPkg(pkg);
    setEditPhone(pkg.recipient_phone);
    setEditName(pkg.recipient_name);
    setEditResult(null);
  };

  const handleCancelEdit = () => {
    setEditingPkg(null);
    setEditResult(null);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingPkg) return;
    if (!editPhone.trim() || !editName.trim()) {
      setEditResult({ type: 'error', message: '请填写所有字段' });
      return;
    }
    setEditLoading(true);
    try {
      const data = await api.updatePackage(editingPkg.id, {
        recipient_phone: editPhone.trim(),
        recipient_name: editName.trim(),
      });
      setEditResult({ type: 'success', message: data.message });
      setPackages(prev => prev.map(p => p.id === editingPkg.id ? data.package : p));
      setTimeout(() => {
        setEditingPkg(null);
        setEditResult(null);
      }, 800);
    } catch (err: any) {
      setEditResult({ type: 'error', message: err.message });
    } finally {
      setEditLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (!trackingNo.trim() || !phone.trim() || !name.trim()) {
      setResult({ type: 'error', message: '请填写所有字段' });
      return;
    }
    setLoading(true);
    try {
      const data = await api.createPackage({
        tracking_no: trackingNo.trim(),
        recipient_phone: phone.trim(),
        recipient_name: name.trim(),
      });
      setResult({ type: 'success', message: data.message, code: data.package.pickup_code });
      setTrackingNo('');
      setPhone('');
      setName('');
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="page-title">快递入库</h1>

      <div className="tabs">
        <button className={`tab-btn ${tab === 'enter' ? 'active' : ''}`} onClick={() => setTab('enter')}>
          扫码入库
        </button>
        <button className={`tab-btn ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          今日入库 ({packages.length})
        </button>
      </div>

      {tab === 'enter' && (
        <div className="card">
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">快递单号</label>
                <input
                  className="form-input form-input-lg"
                  placeholder="扫描或输入快递单号"
                  value={trackingNo}
                  onChange={e => setTrackingNo(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">收件人手机号</label>
                  <input
                    className="form-input"
                    placeholder="11位手机号"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    maxLength={11}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">收件人姓名</label>
                  <input
                    className="form-input"
                    placeholder="收件人姓名"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                {loading ? '入库中...' : '确认入库'}
              </button>
            </form>

            {result && (
              <div className={`result-card ${result.type === 'error' ? 'error' : ''}`} style={{ marginTop: 20 }}>
                {result.type === 'success' ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--success)', marginBottom: 12 }}>
                      {result.message}
                    </div>
                    <div style={{ marginBottom: 8, color: 'var(--gray-600)', fontSize: 14 }}>取件码</div>
                    <div className="code-highlight">{result.code}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--danger)' }}>{result.message}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">今日入库记录</div>
            <button className="btn btn-secondary btn-sm" onClick={loadToday}>刷新</button>
          </div>
          {listLoading ? (
            <div className="loading"><div className="spinner" /><span>加载中...</span></div>
          ) : packages.length === 0 ? (
            <div className="empty-state">
              <p>今日暂无入库记录</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>快递单号</th>
                    <th>收件人</th>
                    <th>手机号</th>
                    <th>取件码</th>
                    <th>状态</th>
                    <th>入库时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map(p => (
                    <tr key={p.id}>
                      <td><span className="tracking-no">{p.tracking_no}</span></td>
                      <td>{p.recipient_name}</td>
                      <td>{p.recipient_phone}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.pickup_code}</td>
                      <td>
                        {p.status === 'picked_up'
                          ? <span className="badge badge-picked">已取件</span>
                          : <span className="badge badge-pending">待取件</span>
                        }
                      </td>
                      <td className="text-sm text-gray">{p.entered_at}</td>
                      <td>
                        {p.status === 'pending' ? (
                          <button className="btn btn-secondary btn-xs" onClick={() => handleEdit(p)}>
                            编辑
                          </button>
                        ) : (
                          <span className="text-gray text-sm">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editingPkg && (
        <div className="modal-overlay" onClick={handleCancelEdit}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">编辑收件信息</div>
              <button className="modal-close" onClick={handleCancelEdit}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 16 }}>
                <span className="text-gray">快递单号：</span>
                <span className="tracking-no">{editingPkg.tracking_no}</span>
              </div>
              <form onSubmit={handleSaveEdit}>
                <div className="form-group">
                  <label className="form-label">收件人姓名</label>
                  <input
                    className="form-input"
                    placeholder="收件人姓名"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">收件人手机号</label>
                  <input
                    className="form-input"
                    placeholder="11位手机号"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    maxLength={11}
                  />
                </div>
                {editResult && (
                  <div className={`result-card ${editResult.type === 'error' ? 'error' : ''}`}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: editResult.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
                      {editResult.message}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                  <button type="button" className="btn btn-secondary" onClick={handleCancelEdit} disabled={editLoading}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={editLoading}>
                    {editLoading ? '保存中...' : '保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
