import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Check,
  Banknote,
  ChefHat,
  ClipboardList,
  Download,
  ExternalLink,
  History,
  ImagePlus,
  LogOut,
  Menu,
  Minus,
  Package,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Store,
  Users,
  Trash2,
  Utensils,
  ChevronLeft,
  ChevronRight,
  Info,
  Phone,
  ShoppingCart,
} from 'lucide-react';
import { API_BASE, api, getUser, logout, money, setSession, updateStoredUser } from './api.js';
import './styles.css';

// ── Router ────────────────────────────────────────────────
function App() {
  const path = window.location.pathname;
  if (path.startsWith('/table/')) return <CustomerOrder qrCode={path.split('/').pop()} />;
  if (path.startsWith('/payment/result')) return <PaymentResult />;
  return <BackOffice />;
}

// ── SSE hook ──────────────────────────────────────────────
function useRealtimeUpdates(resources, onChange) {
  const callbackRef = useRef(onChange);
  const resourceKey = useMemo(() => [...resources].sort().join('|'), [resources]);
  useEffect(() => { callbackRef.current = onChange; }, [onChange]);
  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/events`);
    const handle = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.resource !== 'all' && !resources.includes(payload.resource)) return;
        callbackRef.current?.(payload);
      } catch { /* ignore */ }
    };
    source.addEventListener('data-change', handle);
    return () => source.close();
  }, [resourceKey]);
}

// ══════════════════════════════════════════════════════════
// CUSTOMER PAGE
// ══════════════════════════════════════════════════════════
const HISTORY_PER_PAGE = 5;

function CustomerOrder({ qrCode }) {
  const [phone, setPhone]               = useState(localStorage.getItem('vanmerchant_phone') || '');
  const [authorized, setAuthorized]     = useState(Boolean(phone));
  const [table, setTable]               = useState(null);
  const [categories, setCategories]     = useState([]);
  const [cart, setCart]                 = useState({});
  const [note, setNote]                 = useState('');
  const [history, setHistory]           = useState([]);
  const [message, setMessage]           = useState('');
  const [activeTab, setActiveTab]       = useState('menu');   // 'menu' | 'cart' | 'history'
  const [historyPage, setHistoryPage]   = useState(1);
  const [paymentChoiceOpen, setPaymentChoiceOpen] = useState(false);
  const [draftOrder, setDraftOrder]     = useState(null);
  const [transferIntent, setTransferIntent] = useState(null);
  const [successPopup, setSuccessPopup] = useState(null);
  const [infoPopup, setInfoPopup]       = useState(null);

  const loadCatalog = () =>
    api(`/api/public/tables/${qrCode}`)
      .then((data) => { setTable(data.table); setCategories(data.categories); })
      .catch((err) => setMessage(err.message));

  useEffect(() => { loadCatalog(); }, [qrCode]);

  async function resolveTransferSuccess(result) {
    const latestOrders = await loadHistory();
    const paidOrder = result.order || latestOrders.find((o) => o.paymentStatus === 'PAID');
    if (!paidOrder) {
      return false;
    }

    setTransferIntent(null);
    setDraftOrder(null);
    setCart({});
    setNote('');
    setSuccessPopup({ kind: 'transfer', order: paidOrder });
    setMessage('Thanh toán chuyển khoản đã thành công.');
    return true;
  }

  async function syncTransferIntent(intentId) {
    if (!intentId) {
      return null;
    }

    const result = await api(`/api/public/payment-intents/${intentId}`);
    setTransferIntent((current) => ({ ...current, ...result.intent }));

    if (result.intent.status === 'PAID') {
      await resolveTransferSuccess(result);
    }

    if (['FAILED', 'CANCELLED'].includes(result.intent.status)) {
      setTransferIntent(null);
      setDraftOrder(null);
      setInfoPopup({ title: 'Chưa tạo đơn', body: 'Nếu chưa thanh toán thì đơn hàng chưa được tạo.' });
    }

    return result;
  }

  useRealtimeUpdates(['menu', 'tables', 'orders', 'payment-intents'], (payload) => {
    if (payload.resource === 'payment-intents' && transferIntent?.id && payload.intentId === transferIntent.id) {
      if (payload.action === 'paid') {
        syncTransferIntent(payload.intentId).catch(() => {});
      } else if (payload.action === 'failed') {
        setTransferIntent(null);
        setDraftOrder(null);
        setInfoPopup({
          title: 'Thanh toán thất bại',
          body: 'Giao dịch chưa được ghi nhận, nên đơn hàng chưa được tạo.'
        });
      }
      return;
    }

    if (cartLines.length === 0) loadCatalog();
    if (authorized && phone.length >= 8) loadHistory();
  });

  useEffect(() => {
    if (!transferIntent?.id) return undefined;

    let cancelled = false;
    let timerId = null;

    const pollTransferStatus = async () => {
      try {
        const result = await syncTransferIntent(transferIntent.id);
        if (cancelled) return;

        const status = result?.intent?.status;
        if (!status || ['PAID', 'FAILED', 'CANCELLED'].includes(status)) {
          return;
        }

        timerId = window.setTimeout(pollTransferStatus, 3000);
      } catch {
        if (!cancelled) {
          timerId = window.setTimeout(pollTransferStatus, 5000);
        }
      }
    };

    pollTransferStatus();

    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [transferIntent?.id]);

  const loadHistory = () => {
    if (authorized && phone.length >= 8) {
      return api(`/api/public/customers/${phone}/orders`)
        .then((orders) => { setHistory(orders); return orders; })
        .catch(() => []);
    }
    return Promise.resolve([]);
  };

  useEffect(() => { loadHistory(); }, [authorized, phone]);

  // Derived
  const items = categories.flatMap((c) => c.items);
  const cartLines = Object.entries(cart)
    .map(([id, qty]) => ({ item: items.find((i) => i.id === id), quantity: qty }))
    .filter((l) => l.item);
  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);
  const total = cartLines.reduce((s, l) => s + l.item.price * l.quantity, 0);

  // History pagination
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));
  const historySlice = history.slice((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE);

  function changeQty(id, delta) {
    setCart((c) => {
      const next = Math.max((c[id] || 0) + delta, 0);
      const copy = { ...c };
      if (next === 0) delete copy[id]; else copy[id] = next;
      return copy;
    });
  }

  async function enterPhone(e) {
    e.preventDefault();
    await api('/api/public/customers', { method: 'POST', body: JSON.stringify({ phone }) });
    localStorage.setItem('vanmerchant_phone', phone);
    setAuthorized(true);
  }

  async function submitOrder() {
    setMessage('');
    if (!cartLines.length) return;
    setDraftOrder({ qrCode, phone, note, items: cartLines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity })) });
    setPaymentChoiceOpen(true);
  }

  async function chooseCash() {
    if (!draftOrder) return;
    const order = await api('/api/public/orders', { method: 'POST', body: JSON.stringify({ ...draftOrder, paymentMethod: 'CASH' }) });
    setPaymentChoiceOpen(false); setDraftOrder(null); setCart({}); setNote('');
    await loadHistory();
    setSuccessPopup({ kind: 'cash', order });
  }

  async function chooseTransfer() {
    if (!draftOrder) return;
    const intent = await api('/api/public/payment-intents', { method: 'POST', body: JSON.stringify(draftOrder) });
    setPaymentChoiceOpen(false); setTransferIntent(intent.intent); setDraftOrder(null);
  }

  async function cancelOrder(orderId) {
    await api(`/api/public/orders/${orderId}/cancel`, { method: 'PATCH', body: JSON.stringify({ phone }) });
    await loadHistory();
    setMessage('Đã hủy đơn đang chờ.');
  }

  async function cancelTransfer() {
    if (!transferIntent?.id) return;
    await api(`/api/public/payment-intents/${transferIntent.id}`, { method: 'DELETE', body: JSON.stringify({ phone }) });
    setTransferIntent(null);
    setInfoPopup({ title: 'Đã hủy giao dịch', body: 'Nếu chưa thanh toán thì đơn hàng chưa được tạo.' });
  }

  function downloadQr() {
    const url = transferIntent?.qrDataUrl || transferIntent?.sepayCheckoutUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = `sepay-${transferIntent.referenceCode || 'qr'}.png`;
    a.rel = 'noopener noreferrer'; document.body.append(a); a.click(); a.remove();
  }

  if (!authorized) {
    return (
      <div className="customer-login">
        <div className="login-phone-card">
          <div className="brand-area">
            <Store size={36} />
            <h1>VanMerchant</h1>
          </div>
          <p className="desc">{table ? `${table.name} — nhập số điện thoại để gọi món` : 'Nhập số điện thoại để bắt đầu gọi món'}</p>
          <form className="input-row" onSubmit={enterPhone}>
            <div style={{ position: 'relative' }}>
              <Phone size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
              <input
                className="field"
                style={{ paddingLeft: 36 }}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Số điện thoại"
                type="tel"
                inputMode="numeric"
              />
            </div>
            <button className="btn btn-primary btn-lg btn-full" type="submit">Tiếp tục →</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-shell">
      {/* Top bar */}
      <header className="customer-topbar">
        <Store size={20} style={{ opacity: .85 }} />
        <span className="table-name">{table?.name || 'Gọi món'}</span>
        <span className="phone-chip">📱 {phone}</span>
      </header>

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn ${activeTab === 'menu' ? 'active' : ''}`} onClick={() => setActiveTab('menu')}>
          <Utensils size={16} /> Thực đơn
        </button>
        <button className={`tab-btn ${activeTab === 'cart' ? 'active' : ''}`} onClick={() => setActiveTab('cart')}>
          <ShoppingCart size={16} /> Giỏ hàng
          {cartCount > 0 && <span className="tab-badge">{cartCount}</span>}
        </button>
        <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <History size={16} /> Đơn của tôi
          {history.filter((o) => o.status === 'NEW').length > 0 && (
            <span className="tab-badge">{history.filter((o) => o.status === 'NEW').length}</span>
          )}
        </button>
      </div>

      {message && <div className="notice" style={{ margin: '10px 16px 0' }}>{message}</div>}

      {/* MENU TAB */}
      {activeTab === 'menu' && (
        <>
          <div className="customer-menu-tab">
            {categories.map((cat) => (
              <div className="category-section" key={cat.id}>
                <h2>{cat.name}</h2>
                {cat.items.map((item) => (
                  <div className="menu-item-row" key={item.id} style={{ marginBottom: 8 }}>
                    <img
                      src={item.imageUrl || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=200&q=60'}
                      alt={item.name}
                    />
                    <div className="item-body">
                      <div className="item-name">{item.name}</div>
                      {item.description && <div className="item-desc">{item.description}</div>}
                      <div className="item-price">{money(item.price)}</div>
                    </div>
                    <div className="stepper">
                      <button className="stepper-btn" onClick={() => changeQty(item.id, -1)} disabled={!cart[item.id]}>
                        <Minus size={14} />
                      </button>
                      <span className="stepper-count">{cart[item.id] || 0}</span>
                      <button className="stepper-btn add" onClick={() => changeQty(item.id, 1)}>
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {cartCount > 0 && (
            <div className="cart-footer">
              <div className="cart-footer-row">
                <span className="cart-summary-text"><b>{cartCount}</b> món đã chọn</span>
                <span className="cart-total-row">Tổng: <span className="total-amt">{money(total)}</span></span>
              </div>
              <button className="btn btn-primary btn-full btn-lg" onClick={() => setActiveTab('cart')}>
                Xem giỏ hàng & đặt →
              </button>
            </div>
          )}
        </>
      )}

      {/* CART TAB */}
      {activeTab === 'cart' && (
        <div className="cart-tab">
          {cartLines.length === 0 ? (
            <div className="cart-empty">
              <ShoppingBag size={48} />
              <p>Giỏ hàng trống.<br />Quay lại Thực đơn để chọn món.</p>
              <button className="btn btn-ghost mt-2" onClick={() => setActiveTab('menu')}>← Xem thực đơn</button>
            </div>
          ) : (
            <>
              <div className="cart-lines">
                {cartLines.map((line) => (
                  <div className="cart-line" key={line.item.id}>
                    <div className="stepper">
                      <button className="stepper-btn" onClick={() => changeQty(line.item.id, -1)}><Minus size={13} /></button>
                      <span className="stepper-count">{line.quantity}</span>
                      <button className="stepper-btn add" onClick={() => changeQty(line.item.id, 1)}><Plus size={13} /></button>
                    </div>
                    <span className="name">{line.item.name}</span>
                    <span className="subtotal">{money(line.item.price * line.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="cart-note">
                <label>Ghi chú cho quán</label>
                <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: ít cay, không hành..." />
              </div>

              <div className="cart-summary-card">
                {cartLines.map((line) => (
                  <div className="row" key={line.item.id}>
                    <span>{line.item.name} × {line.quantity}</span>
                    <span>{money(line.item.price * line.quantity)}</span>
                  </div>
                ))}
                <div className="row total-row">
                  <span>Tổng cộng</span>
                  <span className="total-amt">{money(total)}</span>
                </div>
              </div>

              <button className="btn btn-primary btn-full btn-lg" onClick={submitOrder}>
                Gọi món ngay
              </button>
            </>
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="history-tab">
          {history.length === 0 ? (
            <div className="cart-empty">
              <History size={48} />
              <p>Chưa có đơn nào.<br />Hãy đặt món đầu tiên của bạn!</p>
            </div>
          ) : (
            <>
              {historySlice.map((order) => (
                <div className="history-card" key={order.id}>
                  <div className="history-card-head">
                    <div className="order-meta">
                      <b>#{order.dailySequence} — {order.table?.name}</b>
                      <div className="time">{order.createdAt ? new Date(order.createdAt).toLocaleString('vi-VN') : ''}</div>
                    </div>
                    <div className="price-col">
                      <div className="amt">{money(order.subtotal)}</div>
                    </div>
                  </div>
                  <div className="history-badges">
                    <StatusBadge text={order.status} />
                    <StatusBadge text={order.paymentStatus} />
                  </div>
                  <div className="history-items">
                    {order.items.map((item) => (
                      <span key={item.id}>{item.quantity}× {item.name}</span>
                    ))}
                  </div>
                  {order.status === 'NEW' && (
                    <button className="btn btn-danger btn-full mt-2" style={{ marginTop: 10 }} onClick={() => cancelOrder(order.id)}>
                      <Trash2 size={14} /> Hủy đơn đang chờ
                    </button>
                  )}
                </div>
              ))}

              {totalPages > 1 && (
                <Pagination page={historyPage} total={totalPages} onChange={setHistoryPage} />
              )}
            </>
          )}
        </div>
      )}

      {/* MODALS */}
      {paymentChoiceOpen && draftOrder && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon info"><ReceiptText size={24} /></div>
            <h2>Chọn hình thức thanh toán</h2>
            <p>Đơn được tạo ngay với tiền mặt. Chuyển khoản sẽ chờ ngân hàng xác nhận.</p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-full btn-lg" onClick={chooseCash}>💵 Tiền mặt</button>
              <button className="btn btn-ghost btn-full btn-lg" onClick={chooseTransfer}>🏦 Chuyển khoản</button>
            </div>
          </div>
        </div>
      )}

      {transferIntent && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon info"><QrCode size={24} /></div>
            <h2>Quét mã QR chuyển khoản</h2>
            <p>Sau khi ngân hàng xác nhận, đơn hàng mới được tạo tự động.</p>
            {transferIntent.qrDataUrl && (
              <div className="payment-qr-box">
                <img src={transferIntent.qrDataUrl} alt="SePay QR" />
                <p>Đang chờ xác nhận ngân hàng…</p>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary btn-full" onClick={downloadQr}><Download size={15} /> Tải ảnh QR</button>
              <button className="btn btn-danger btn-full" onClick={cancelTransfer}>Hủy giao dịch</button>
            </div>
          </div>
        </div>
      )}

      {successPopup && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon success"><Check size={24} /></div>
            <h2>Gọi món thành công!</h2>
            <p>
              {successPopup.kind === 'cash'
                ? `Đơn #${successPopup.order.dailySequence} đã được tạo ngay — thanh toán khi nhận.`
                : `Đơn #${successPopup.order.dailySequence} được tạo sau khi ngân hàng xác nhận chuyển khoản.`}
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-full btn-lg" onClick={() => { setSuccessPopup(null); setActiveTab('history'); }}>
                Xem đơn của tôi
              </button>
              <button className="btn btn-ghost btn-full" onClick={() => setSuccessPopup(null)}>Tiếp tục gọi món</button>
            </div>
          </div>
        </div>
      )}

      {infoPopup && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon warning"><Info size={24} /></div>
            <h2>{infoPopup.title}</h2>
            <p>{infoPopup.body}</p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-full btn-lg" onClick={() => setInfoPopup(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────
function Pagination({ page, total, onChange }) {
  return (
    <div className="pagination">
      <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1}>
        <ChevronLeft size={14} />
      </button>
      {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
        <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => onChange(p)}>{p}</button>
      ))}
      <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page === total}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────
const STATUS_MAP = {
  NEW: 'Mới', PREPARING: 'Đang làm', DELIVERING: 'Đang giao',
  DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy',
  PAID: 'Đã TT', UNPAID: 'Chưa TT', PENDING_PAYMENT: 'Chờ TT',
};
function StatusBadge({ text }) {
  const key = String(text).toLowerCase();
  return <span className={`badge badge-${key}`}>{STATUS_MAP[text] || text}</span>;
}

// ── Payment result ────────────────────────────────────────
function PaymentResult() {
  return (
    <div className="result-page">
      <ReceiptText size={52} />
      <h1>Đã quay lại từ cổng thanh toán</h1>
      <p>Quán sẽ nhận trạng thái chính thức từ webhook SePay. Nếu ngân hàng đã báo thành công, đơn sẽ tự chuyển sang đang làm.</p>
      <a href="/">← Về trang chính</a>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// BACK-OFFICE
// ══════════════════════════════════════════════════════════
function BackOffice() {
  const [user, setUser] = useState(getUser());
  if (!user) return <Login onLogin={setUser} />;
  return <DashboardShell user={user} onLogout={() => { logout(); setUser(null); }} onUserChange={setUser} />;
}

function Login({ onLogin }) {
  const [email, setEmail]       = useState('admin@vanmerchant.local');
  const [password, setPassword] = useState('admin123');
  const [error, setError]       = useState('');

  async function submit(e) {
    e.preventDefault();
    try {
      const session = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setSession(session);
      onLogin(session.user);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-area">
          <ChefHat size={36} />
          <h1>VanMerchant POS</h1>
        </div>
        <p className="sub">Quản lý quán, đơn hàng & nhân sự</p>
        <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
        <input className="field" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Mật khẩu" />
        {error && <p className="notice notice-err">{error}</p>}
        <button className="btn btn-primary btn-lg btn-full" type="submit">Đăng nhập</button>
      </form>
    </div>
  );
}

function DashboardShell({ user, onLogout, onUserChange }) {
  const canManage = ['OWNER', 'ADMIN'].includes(user.role);
  const [tab, setTab]           = useState(canManage ? 'overview' : 'orders');
  const [refreshToken, setRefresh] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = [
    { id: 'overview',     label: 'Doanh thu',   hint: 'Xem doanh thu hôm nay', icon: <BarChart3 size={18} />,    hidden: !canManage },
    { id: 'orders',       label: 'Đang làm',    hint: 'Đơn mới và đang nấu', icon: <ClipboardList size={18} /> },
    { id: 'delivery',     label: 'Chờ giao',    hint: 'Đơn chuẩn bị giao', icon: <ReceiptText size={18} /> },
    { id: 'history',      label: 'Lịch sử',     hint: 'Các đơn đã xử lý', icon: <History size={18} /> },
    { id: 'menu',         label: 'Menu',        hint: 'Món ăn và giá bán', icon: <Utensils size={18} />,     hidden: !canManage },
    { id: 'ingredients',  label: 'Nguyên liệu', hint: 'Tồn kho và giá vốn', icon: <Package size={18} />,  hidden: !canManage },
    { id: 'tables',       label: 'Bàn & QR',    hint: 'Mã bàn và in QR', icon: <QrCode size={18} />,       hidden: !canManage },
    { id: 'accounts',     label: 'Tài khoản',   hint: 'Quản lý nhân sự', icon: <Users size={18} />,        hidden: !canManage },
  ].filter((n) => !n.hidden);

  return (
    <div className="app-shell">
      {/* Sidebar / mobile bottom nav */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Store size={22} />
          <span>VanMerchant</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${tab === n.id ? 'active' : ''}`}
              onClick={() => {
                setTab(n.id);
                setMobileNavOpen(false);
              }}
            >
              {n.icon}
              <span className="nav-label nav-label-desktop">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={onLogout} style={{ width: '100%' }}>
            <LogOut size={18} /><span className="nav-label nav-label-desktop">Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Main workspace */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-user">
            <p>{user.role}</p>
            <h1>{user.name}</h1>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-ghost topbar-menu-btn" onClick={() => setMobileNavOpen(true)}>
              <Menu size={15} /> Menu
            </button>
            <button className="btn btn-ghost" onClick={() => setRefresh((v) => v + 1)}>
              <RefreshCw size={15} /> Làm mới
            </button>
          </div>
        </header>
        <div className="workspace-body">
          {tab === 'overview'    && <Overview refreshToken={refreshToken} />}
          {tab === 'orders'      && <Orders title="Bill đang làm" statuses={['NEW', 'PREPARING']} user={user} refreshToken={refreshToken} />}
          {tab === 'delivery'    && <Orders title="Bill chờ giao" statuses={['DELIVERING']} user={user} emptyText="Chưa có bill nào chờ giao." refreshToken={refreshToken} />}
          {tab === 'history'     && <OrderHistory user={user} refreshToken={refreshToken} />}
          {tab === 'menu'        && <MenuManager refreshToken={refreshToken} />}
          {tab === 'ingredients' && <IngredientManager refreshToken={refreshToken} />}
          {tab === 'tables'      && <TableManager refreshToken={refreshToken} />}
          {tab === 'accounts'    && <AccountManager currentUser={user} onCurrentUserChange={onUserChange} refreshToken={refreshToken} onLogout={onLogout} />}
        </div>
      </div>

      <div className={`mobile-nav-drawer ${mobileNavOpen ? 'open' : ''}`} aria-hidden={!mobileNavOpen}>
        <button className="mobile-nav-backdrop" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Đóng menu" />
        <div className="mobile-nav-panel" role="dialog" aria-label="Điều hướng quản trị">
          <div className="mobile-nav-head">
            <div>
              <p>Điều hướng</p>
              <h2>Chọn chức năng</h2>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => setMobileNavOpen(false)}>
              Đóng
            </button>
          </div>
          <nav className="mobile-nav-list">
            {navItems.map((n) => (
              <button
                key={n.id}
                className={`mobile-nav-item ${tab === n.id ? 'active' : ''}`}
                onClick={() => {
                  setTab(n.id);
                  setMobileNavOpen(false);
                }}
              >
                <span className="mobile-nav-icon">{n.icon}</span>
                <span className="mobile-nav-text">
                  <b>{n.label}</b>
                  <small>{n.hint}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </nav>
          <button className="mobile-nav-logout" type="button" onClick={onLogout}>
            <LogOut size={18} /> Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────
function Overview({ refreshToken }) {
  const [data, setData] = useState(null);
  const load = () => api('/api/admin/dashboard').then(setData);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['dashboard', 'orders', 'ingredients'], load);
  if (!data) return <p className="muted">Đang tải...</p>;

  return (
    <div className="overview-panel">
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="label">Doanh thu</div>
          <div className="value">{money(data.revenue)}</div>
        </div>
        <div className="metric-card">
          <div className="label">Chi phí</div>
          <div className="value">{money(data.cost)}</div>
        </div>
        <div className="metric-card accent">
          <div className="label">Lãi gộp</div>
          <div className="value">{money(data.profit)}</div>
        </div>
        <div className="metric-card">
          <div className="label">Số đơn</div>
          <div className="value">{data.orderCount}</div>
        </div>
      </div>
      <div className="overview-feed">
        <div className="section-head"><h2>Đơn gần đây</h2></div>
        {data.recentOrders.map((order) => <OrderRowCompact key={order.id} order={order} />)}
      </div>
    </div>
  );
}

function OrderRowCompact({ order }) {
  return (
    <div className="order-row-compact">
      <b>#{order.dailySequence}</b>
      <span className="order-table-name">{order.table?.name}</span>
      <span className="order-amount">{money(order.subtotal)}</span>
      <StatusBadge text={order.status} />
      <StatusBadge text={order.paymentStatus} />
    </div>
  );
}

// ── Orders (kanban-style) ──────────────────────────────────
const ORDERS_PER_PAGE = 12;

function Orders({ title, statuses, emptyText = 'Chưa có bill.', user, refreshToken }) {
  const [orders, setOrders] = useState([]);
  const [page, setPage]     = useState(1);
  const statusQuery = statuses?.length ? `?status=${statuses.join(',')}` : '';
  const load = () => api(`/api/orders${statusQuery}`).then(setOrders);
  useEffect(() => { load(); setPage(1); }, [statusQuery, refreshToken]);
  useRealtimeUpdates(['orders', 'dashboard'], load);

  async function update(id, patch) {
    await api(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify(patch) });
    load();
  }

  const totalPages = Math.max(1, Math.ceil(orders.length / ORDERS_PER_PAGE));
  const slice = orders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE);

  return (
    <div>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="count">{orders.length} đơn</span>
      </div>
      {orders.length === 0 && (
        <div className="empty-state"><ClipboardList size={40} /><p>{emptyText}</p></div>
      )}
      <div className="orders-grid">
        {slice.map((order) => (
          <div className="order-card" key={order.id}>
            <div className="order-card-header">
              <div>
                <h3>#{order.dailySequence} — {order.table?.name}</h3>
                {order.createdAt && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{new Date(order.createdAt).toLocaleTimeString('vi-VN')}</div>}
              </div>
              <span className="price">{money(order.subtotal)}</span>
            </div>
            <div className="order-badges">
              <StatusBadge text={order.status} />
              <StatusBadge text={order.paymentStatus} />
            </div>
            <div className="order-items-list">
              {order.items.map((item) => (
                <div className="order-item-row" key={item.id}>
                  <span>{item.quantity}× {item.name}</span>
                  <span>{money(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="order-actions">
              <button className="btn btn-ghost" onClick={() => update(order.id, { status: 'PREPARING' })}>
                <ChefHat size={14} /> Làm
              </button>
              <button className="btn btn-ghost" onClick={() => update(order.id, { status: 'DELIVERING' })}>
                <ReceiptText size={14} /> Giao
              </button>
              <button className="btn btn-ghost" onClick={() => update(order.id, { status: 'DELIVERED' })}>
                <Check size={14} /> Xong
              </button>
              {order.paymentStatus !== 'PAID' && (
                <button className="btn btn-ghost" onClick={() => update(order.id, { paymentStatus: 'PAID' })}>
                  💵 Đã TT
                </button>
              )}
              {['OWNER', 'ADMIN'].includes(user?.role) && order.status !== 'CANCELLED' && (
                <button className="btn btn-danger" onClick={() => update(order.id, { status: 'CANCELLED' })}>
                  <Trash2 size={14} /> Hủy
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onChange={setPage} />}
    </div>
  );
}

// ── Order History (full) ──────────────────────────────────
const HISTORY_PAGE_SIZE = 20;
function OrderHistory({ user, refreshToken }) {
  const [orders, setOrders] = useState([]);
  const [page, setPage]     = useState(1);
  const load = () => api('/api/orders').then(setOrders);
  useEffect(() => { load(); setPage(1); }, [refreshToken]);
  useRealtimeUpdates(['orders'], load);

  const totalPages = Math.max(1, Math.ceil(orders.length / HISTORY_PAGE_SIZE));
  const slice = orders.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  return (
    <div>
      <div className="section-head">
        <h2>Lịch sử đơn hàng</h2>
        <span className="count">{orders.length} đơn</span>
      </div>
      {orders.length === 0 && <div className="empty-state"><History size={40} /><p>Chưa có lịch sử đơn.</p></div>}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-s)', overflow: 'hidden' }}>
        {slice.map((order, i) => (
          <div key={order.id} style={{ padding: '12px 16px', borderBottom: i < slice.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <b style={{ fontFamily: 'var(--font-display)', minWidth: 60 }}>#{order.dailySequence}</b>
            <span style={{ flex: 1, fontSize: 14, color: 'var(--ink-2)' }}>{order.table?.name}</span>
            <span style={{ fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>{money(order.subtotal)}</span>
            <StatusBadge text={order.status} />
            <StatusBadge text={order.paymentStatus} />
            {order.createdAt && <span className="muted" style={{ width: '100%', fontSize: 12 }}>{new Date(order.createdAt).toLocaleString('vi-VN')} — {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span>}
          </div>
        ))}
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onChange={setPage} />}
    </div>
  );
}

// ── Menu Manager ──────────────────────────────────────────
function MenuManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm]   = useState({ name: '', price: 0, description: '', imageUrl: '' });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(null);
  const load = () => api('/api/admin/menu-items').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['menu'], load);

  function chooseImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((c) => ({ ...c, imageUrl: reader.result }));
    reader.readAsDataURL(file);
  }

  async function submit(e) {
    e.preventDefault();
    await api('/api/admin/menu-items', { method: 'POST', body: JSON.stringify({ ...form, price: Number(form.price) }) });
    setForm({ name: '', price: 0, description: '', imageUrl: '' });
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingForm({
      name: item.name,
      price: item.price,
      description: item.description || '',
      imageUrl: item.imageUrl || '',
      active: item.active !== false,
      categoryId: item.categoryId || ''
    });
  }

  async function saveEdit(itemId) {
    await api(`/api/admin/menu-items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...editingForm,
        price: Number(editingForm.price),
        categoryId: editingForm.categoryId || null
      })
    });
    setEditingId(null);
    setEditingForm(null);
    load();
  }

  async function removeItem(itemId) {
    if (!window.confirm('Ẩn món này khỏi menu?')) return;
    await api(`/api/admin/menu-items/${itemId}`, { method: 'DELETE' });
    if (editingId === itemId) {
      setEditingId(null);
      setEditingForm(null);
    }
    load();
  }

  return (
    <div>
      <div className="section-head"><h2>Menu</h2><span className="count">{items.length} món</span></div>
      <form className="menu-add-form" onSubmit={submit}>
        <label className="image-picker">
          {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <><ImagePlus size={28} /><span>Thêm ảnh</span></>}
          <input type="file" accept="image/*" onChange={chooseImage} />
        </label>
        <div className="form-fields">
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tên món" />
          <input className="field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Giá bán (VND)" type="number" />
          <textarea className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mô tả món" />
          <button className="btn btn-primary" type="submit"><Plus size={16} /> Thêm món</button>
        </div>
      </form>
      <div className="menu-grid">
        {items.map((item) => (
          <div className={`menu-admin-card ${item.active === false ? 'is-muted' : ''}`} key={item.id}>
            <img src={item.imageUrl || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=300&q=60'} alt={item.name} />
            {editingId === item.id && editingForm ? (
              <div className="card-edit-panel">
                <input className="field" value={editingForm.name} onChange={(e) => setEditingForm({ ...editingForm, name: e.target.value })} placeholder="Tên món" />
                <input className="field" value={editingForm.price} onChange={(e) => setEditingForm({ ...editingForm, price: e.target.value })} placeholder="Giá bán" type="number" />
                <textarea className="field" value={editingForm.description} onChange={(e) => setEditingForm({ ...editingForm, description: e.target.value })} placeholder="Mô tả" />
                <input className="field" value={editingForm.imageUrl} onChange={(e) => setEditingForm({ ...editingForm, imageUrl: e.target.value })} placeholder="URL ảnh" />
                <div className="admin-card-actions">
                  <button className="btn btn-primary" type="button" onClick={() => saveEdit(item.id)}><Check size={14} /> Lưu</button>
                  <button className="btn btn-ghost" type="button" onClick={() => { setEditingId(null); setEditingForm(null); }}>Hủy</button>
                </div>
              </div>
            ) : (
              <div className="menu-admin-body">
                <div className="info">
                  <b>{item.name}</b>
                  <span className="price">{money(item.price)}</span>
                </div>
                <p className="muted menu-admin-desc">{item.description || 'Không có mô tả'}</p>
                <div className="admin-card-actions">
                  <button className="btn btn-ghost" type="button" onClick={() => startEdit(item)}><Utensils size={14} /> Sửa</button>
                  <button className="btn btn-danger" type="button" onClick={() => removeItem(item.id)}><Trash2 size={14} /> Xóa</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ingredient Manager ────────────────────────────────────
function IngredientManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm]   = useState({ name: '', unit: 'g', stock: 0, minStock: 0, unitCost: 0 });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(null);
  const load = () => api('/api/admin/ingredients').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['ingredients'], load);

  async function submit(e) {
    e.preventDefault();
    await api('/api/admin/ingredients', { method: 'POST', body: JSON.stringify({ ...form, stock: Number(form.stock), minStock: Number(form.minStock), unitCost: Number(form.unitCost) }) });
    setForm({ name: '', unit: 'g', stock: 0, minStock: 0, unitCost: 0 });
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingForm({
      name: item.name,
      unit: item.unit,
      stock: item.stock,
      minStock: item.minStock,
      unitCost: item.unitCost,
      active: item.active !== false
    });
  }

  async function saveEdit(itemId) {
    await api(`/api/admin/ingredients/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...editingForm,
        stock: Number(editingForm.stock),
        minStock: Number(editingForm.minStock),
        unitCost: Number(editingForm.unitCost)
      })
    });
    setEditingId(null);
    setEditingForm(null);
    load();
  }

  async function removeItem(itemId) {
    if (!window.confirm('Ẩn nguyên liệu này?')) return;
    await api(`/api/admin/ingredients/${itemId}`, { method: 'DELETE' });
    if (editingId === itemId) {
      setEditingId(null);
      setEditingForm(null);
    }
    load();
  }

  return (
    <div>
      <div className="section-head"><h2>Nguyên liệu</h2><span className="count">{items.length}</span></div>
      <form className="inline-form" onSubmit={submit}>
        {['name', 'unit', 'stock', 'minStock', 'unitCost'].map((f) => (
          <input key={f} className="field" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} placeholder={f} />
        ))}
        <button className="btn btn-primary" type="submit"><Plus size={15} /> Thêm</button>
      </form>
      <div className="ingredient-list">
        {items.map((item) => (
          <div className={`ingredient-row ${item.active === false ? 'is-muted' : ''}`} key={item.id}>
            {editingId === item.id && editingForm ? (
              <div className="card-edit-panel full-width">
                <div className="inline-form compact-form">
                  <input className="field" value={editingForm.name} onChange={(e) => setEditingForm({ ...editingForm, name: e.target.value })} placeholder="Tên" />
                  <input className="field" value={editingForm.unit} onChange={(e) => setEditingForm({ ...editingForm, unit: e.target.value })} placeholder="Đơn vị" />
                  <input className="field" value={editingForm.stock} onChange={(e) => setEditingForm({ ...editingForm, stock: e.target.value })} placeholder="Tồn kho" type="number" />
                  <input className="field" value={editingForm.minStock} onChange={(e) => setEditingForm({ ...editingForm, minStock: e.target.value })} placeholder="Tối thiểu" type="number" />
                  <input className="field" value={editingForm.unitCost} onChange={(e) => setEditingForm({ ...editingForm, unitCost: e.target.value })} placeholder="Giá vốn" type="number" />
                </div>
                <div className="admin-card-actions">
                  <button className="btn btn-primary" type="button" onClick={() => saveEdit(item.id)}><Check size={14} /> Lưu</button>
                  <button className="btn btn-ghost" type="button" onClick={() => { setEditingId(null); setEditingForm(null); }}>Hủy</button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <b>{item.name}</b>
                  <div className="meta">{item.stock} {item.unit} · Tối thiểu: {item.minStock} · {money(item.unitCost)}/{item.unit}</div>
                </div>
                <div className="admin-card-actions">
                  <button className="btn btn-ghost" type="button" onClick={() => startEdit(item)}><Package size={14} /> Sửa</button>
                  <button className="btn btn-danger" type="button" onClick={() => removeItem(item.id)}><Trash2 size={14} /> Xóa</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Table Manager ─────────────────────────────────────────
function TableManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm]   = useState({ name: '', qrCode: '', seats: 4 });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(null);
  const load = () => api('/api/admin/tables').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['tables'], load);

  async function submit(e) {
    e.preventDefault();
    await api('/api/admin/tables', { method: 'POST', body: JSON.stringify({ ...form, qrCode: form.qrCode.trim() || undefined, seats: Number(form.seats) }) });
    setForm({ name: '', qrCode: '', seats: 4 });
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingForm({
      name: item.name,
      qrCode: item.qrCode,
      seats: item.seats,
      active: item.active !== false
    });
  }

  async function saveEdit(itemId) {
    await api(`/api/admin/tables/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...editingForm,
        seats: Number(editingForm.seats)
      })
    });
    setEditingId(null);
    setEditingForm(null);
    load();
  }

  async function removeItem(itemId) {
    if (!window.confirm('Ẩn bàn này?')) return;
    await api(`/api/admin/tables/${itemId}`, { method: 'DELETE' });
    if (editingId === itemId) {
      setEditingId(null);
      setEditingForm(null);
    }
    load();
  }

  return (
    <div>
      <div className="section-head"><h2>Bàn & QR</h2><span className="count">{items.length} bàn</span></div>
      <form className="inline-form" onSubmit={submit}>
        <input className="field" value={form.name}    onChange={(e) => setForm({ ...form, name: e.target.value })}    placeholder="Tên bàn" />
        <input className="field" value={form.qrCode}  onChange={(e) => setForm({ ...form, qrCode: e.target.value })}  placeholder="Mã QR (tự sinh nếu trống)" />
        <input className="field" value={form.seats}   onChange={(e) => setForm({ ...form, seats: e.target.value })}   placeholder="Số ghế" type="number" style={{ maxWidth: 100 }} />
        <button className="btn btn-primary" type="submit"><Plus size={15} /> Thêm</button>
      </form>
      <div className="qr-grid">
        {items.map((item) => (
          <div className={`qr-card ${item.active === false ? 'is-muted' : ''}`} key={item.id}>
            <img src={item.qrDataUrl} alt={`QR ${item.name}`} />
            <div className="qr-card-body">
              {editingId === item.id && editingForm ? (
                <>
                  <input className="field" value={editingForm.name} onChange={(e) => setEditingForm({ ...editingForm, name: e.target.value })} placeholder="Tên bàn" />
                  <input className="field" value={editingForm.qrCode} onChange={(e) => setEditingForm({ ...editingForm, qrCode: e.target.value })} placeholder="Mã QR" />
                  <input className="field" value={editingForm.seats} onChange={(e) => setEditingForm({ ...editingForm, seats: e.target.value })} placeholder="Số ghế" type="number" />
                  <div className="admin-card-actions">
                    <button className="btn btn-primary" type="button" onClick={() => saveEdit(item.id)}><Check size={14} /> Lưu</button>
                    <button className="btn btn-ghost" type="button" onClick={() => { setEditingId(null); setEditingForm(null); }}>Hủy</button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{item.name}</h3>
                  <p className="code">{item.qrCode}</p>
                  <a className="url" href={item.orderUrl} target="_blank" rel="noreferrer">{item.orderUrl}</a>
                  <div className="actions">
                    <a className="btn btn-ghost" href={item.orderUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}><ExternalLink size={13} /> Mở</a>
                    <a className="btn btn-ghost" href={item.qrDataUrl} download={`${item.qrCode}.png`} style={{ fontSize: 13 }}><Download size={13} /> QR</a>
                    <button className="btn btn-ghost" type="button" style={{ fontSize: 13 }} onClick={() => startEdit(item)}><QrCode size={13} /> Sửa</button>
                    <button className="btn btn-danger" type="button" style={{ fontSize: 13 }} onClick={() => removeItem(item.id)}><Trash2 size={13} /> Xóa</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Account Manager ───────────────────────────────────────
function AccountManager({ currentUser, onCurrentUserChange, refreshToken, onLogout }) {
  const [users, setUsers]   = useState([]);
  const [error, setError]   = useState('');
  const [form, setForm]     = useState({ name: '', email: '', password: '', role: 'STAFF' });
  const roleOptions = currentUser.role === 'ADMIN' ? ['STAFF', 'OWNER', 'ADMIN'] : ['STAFF', 'OWNER'];

  const load = () => {
    setError('');
    return api('/api/admin/users').then(setUsers).catch((err) => setError(err.message));
  };
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['users'], load);

  async function submit(e) {
    e.preventDefault();
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...form }) });
      setForm({ name: '', email: '', password: '', role: 'STAFF' });
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Tài khoản</h2>
          <p className="muted" style={{ marginTop: 2 }}>Tạo, đổi vai trò và xóa tài khoản nhân viên.</p>
        </div>
        <span className="count">{users.length} tài khoản</span>
      </div>

      <form className="account-create" onSubmit={submit}>
        <input className="field" value={form.name}     onChange={(e) => setForm({ ...form, name: e.target.value })}     placeholder="Tên hiển thị" />
        <input className="field" value={form.email}    onChange={(e) => setForm({ ...form, email: e.target.value })}    placeholder="Email" type="email" />
        <input className="field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" placeholder="Mật khẩu" />
        <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn btn-primary" type="submit"><Users size={15} /> Tạo</button>
      </form>

      {error && <p className="notice notice-err" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="account-grid">
        {users.map((user) => (
          <UserCard key={user.id} user={user} currentUser={currentUser} roleOptions={roleOptions} onSaved={load} onDeleted={load} onCurrentUserChange={onCurrentUserChange} onLogout={onLogout} />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, currentUser, roleOptions, onSaved, onDeleted, onCurrentUserChange, onLogout }) {
  const locked = currentUser.role === 'OWNER' && user.role === 'ADMIN';
  const [form, setForm] = useState({ name: user.name, email: user.email, role: user.role, password: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const clean = form.name === user.name && form.email === user.email && form.role === user.role && form.password === '';
    if (clean) setForm({ name: user.name, email: user.email, role: user.role, password: '' });
  }, [user.id, user.name, user.email, user.role]);

  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { name: form.name, email: form.email, role: form.role };
      if (form.password.trim()) payload.password = form.password;
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setError(''); await onSaved(); setForm((c) => ({ ...c, password: '' }));
      if (user.id === currentUser.id) {
        if (payload.role !== currentUser.role) { onLogout(); return; }
        const next = { ...currentUser, name: payload.name, email: payload.email, role: payload.role };
        updateStoredUser(next); onCurrentUserChange(next);
      }
    } catch (err) { setError(err.message); }
  }

  async function remove() {
    if (!window.confirm(`Xóa tài khoản ${user.email}?`)) return;
    try { await api(`/api/admin/users/${user.id}`, { method: 'DELETE' }); await onDeleted(); }
    catch (err) { setError(err.message); }
  }

  return (
    <div className={`user-card ${locked ? 'locked' : ''}`}>
      <div className="user-card-head">
        <div><b>{user.name}</b><p>{user.email}</p></div>
        <StatusBadge text={user.role} />
      </div>
      <form className="user-card-form" onSubmit={submit}>
        <input className="field" value={form.name}     onChange={(e) => setForm({ ...form, name: e.target.value })}     disabled={locked} placeholder="Tên" />
        <input className="field" value={form.email}    onChange={(e) => setForm({ ...form, email: e.target.value })}    disabled={locked} placeholder="Email" />
        <select className="field" value={form.role}    onChange={(e) => setForm({ ...form, role: e.target.value })}     disabled={locked}>
          {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input className="field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} disabled={locked} type="password" placeholder="Đặt lại mật khẩu" />
        <div className="order-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={locked}><Users size={14} /> Lưu</button>
          <button className="btn btn-danger" type="button" onClick={remove} disabled={locked || user.id === currentUser.id}>
            <Trash2 size={14} /> Xóa
          </button>
        </div>
      </form>
      {locked && <p className="muted" style={{ marginTop: 8 }}>Admin chỉ có thể thao tác bởi admin cấp cao hơn.</p>}
      {error && <p className="notice notice-err" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);