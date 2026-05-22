import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Check,
  ChefHat,
  ClipboardList,
  Download,
  ExternalLink,
  History,
  ImagePlus,
  LogOut,
  Minus,
  Package,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Store,
  Users,
  Trash2,
  Utensils
} from 'lucide-react';
import { API_BASE, api, getUser, logout, money, setSession, updateStoredUser } from './api.js';
import './styles.css';

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/table/')) return <CustomerOrder qrCode={path.split('/').pop()} />;
  if (path.startsWith('/payment/result')) return <PaymentResult />;
  return <BackOffice />;
}

function useRealtimeUpdates(resources, onChange) {
  const callbackRef = useRef(onChange);
  const resourceKey = useMemo(() => [...resources].sort().join('|'), [resources]);

  useEffect(() => {
    callbackRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/events`);

    const handleChange = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.resource !== 'all' && !resources.includes(payload.resource)) return;
        callbackRef.current?.(payload);
      } catch {
        return;
      }
    };

    source.addEventListener('data-change', handleChange);
    return () => source.close();
  }, [resourceKey]);
}

function CustomerOrder({ qrCode }) {
  const [phone, setPhone] = useState(localStorage.getItem('vanmerchant_phone') || '');
  const [authorized, setAuthorized] = useState(Boolean(phone));
  const [table, setTable] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState({});
  const [note, setNote] = useState('');
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState('');
  const [paymentChoiceOpen, setPaymentChoiceOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState(null);
  const [transferIntent, setTransferIntent] = useState(null);
  const [successPopup, setSuccessPopup] = useState(null);
  const [infoPopup, setInfoPopup] = useState(null);

  const loadCatalog = () => api(`/api/public/tables/${qrCode}`)
    .then((data) => {
      setTable(data.table);
      setCategories(data.categories);
    })
    .catch((error) => setMessage(error.message));

  useEffect(() => {
    loadCatalog();
  }, [qrCode]);

  useRealtimeUpdates(['menu', 'tables', 'orders'], () => {
    if (cartLines.length === 0) {
      loadCatalog();
    }

    if (authorized && phone.length >= 8) {
      loadHistory();
    }
  });

  useEffect(() => {
    if (!transferIntent?.id) {
      return undefined;
    }

    let cancelled = false;

    const pollTransferStatus = async () => {
      try {
        const result = await api(`/api/public/payment-intents/${transferIntent.id}`);
        if (cancelled) {
          return;
        }

        setTransferIntent((current) => ({ ...current, ...result.intent }));

        if (result.intent.status === 'PAID') {
          const latestOrders = await loadHistory();
          const paidOrder = result.order || latestOrders.find((order) => order.paymentStatus === 'PAID');

          if (!paidOrder) {
            return;
          }

          setTransferIntent(null);
          setDraftOrder(null);
          setCart({});
          setNote('');
          setSuccessPopup({ kind: 'transfer', order: paidOrder });
          setMessage('Thanh toán chuyển khoản đã thành công.');
        }

        if (result.intent.status === 'FAILED' || result.intent.status === 'CANCELLED') {
          setTransferIntent(null);
          setDraftOrder(null);
          setInfoPopup({
            title: 'Chưa tạo đơn',
            body: 'Nếu chưa thanh toán thì đơn hàng chưa được tạo.'
          });
        }
      } catch {
        return;
      }
    };

    pollTransferStatus();
    const timer = setInterval(pollTransferStatus, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [transferIntent?.id]);

  const loadHistory = () => {
    if (authorized && phone.length >= 8) {
      return api(`/api/public/customers/${phone}/orders`)
        .then((orders) => {
          setHistory(orders);
          return orders;
        })
        .catch(() => []);
    }
    return Promise.resolve([]);
  };

  useEffect(() => {
    loadHistory();
  }, [authorized, phone]);

  const items = categories.flatMap((category) => category.items);
  const cartLines = Object.entries(cart)
    .map(([id, quantity]) => ({ item: items.find((menuItem) => menuItem.id === id), quantity }))
    .filter((line) => line.item);
  const total = cartLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);

  function changeQuantity(id, delta) {
    setCart((current) => {
      const next = Math.max((current[id] || 0) + delta, 0);
      const copy = { ...current };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  async function enterPhone(event) {
    event.preventDefault();
    await api('/api/public/customers', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
    localStorage.setItem('vanmerchant_phone', phone);
    setAuthorized(true);
  }

  async function submitOrder() {
    setMessage('');
    if (!cartLines.length) {
      return;
    }

    setDraftOrder({
      qrCode,
      phone,
      note,
      items: cartLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity }))
    });
    setPaymentChoiceOpen(true);
  }

  async function chooseCashPayment() {
    if (!draftOrder) return;

    const order = await api('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify({ ...draftOrder, paymentMethod: 'CASH' })
    });

    setPaymentChoiceOpen(false);
    setDraftOrder(null);
    setCart({});
    setNote('');
    await loadHistory();
    setSuccessPopup({ kind: 'cash', order });
  }

  async function chooseTransferPayment() {
    if (!draftOrder) return;

    const intent = await api('/api/public/payment-intents', {
      method: 'POST',
      body: JSON.stringify(draftOrder)
    });

    setPaymentChoiceOpen(false);
    setTransferIntent(intent.intent);
    setDraftOrder(null);
  }

  async function cancelCustomerOrder(orderId) {
    await api(`/api/public/orders/${orderId}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ phone })
    });
    await loadHistory();
    setMessage('Đã hủy đơn đang chờ.');
  }

  function showOrders() {
    setSuccessPopup(null);
    setInfoPopup(null);
    document.getElementById('customer-history')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function cancelTransferPayment() {
    if (!transferIntent?.id) return;

    await api(`/api/public/payment-intents/${transferIntent.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ phone })
    });
    setTransferIntent(null);
    setInfoPopup({
      title: 'Đã hủy giao dịch',
      body: 'Nếu chưa thanh toán thì đơn hàng chưa được tạo.'
    });
  }

  function downloadTransferQr() {
    const paymentUrl = transferIntent?.qrDataUrl || transferIntent?.sepayCheckoutUrl;
    if (!paymentUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = paymentUrl;
    link.download = `sepay-${transferIntent.referenceCode || 'qr'}.png`;
    link.rel = 'noopener noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
  }

  if (!authorized) {
    return (
      <main className="customer-login">
        <section className="phone-panel">
          <Store size={42} />
          <h1>VanMerchant</h1>
          <p>{table ? `${table.name} - nhập số điện thoại để gọi món` : 'Nhập số điện thoại để gọi món'}</p>
          <form onSubmit={enterPhone}>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Số điện thoại" />
            <button type="submit">Tiếp tục</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="order-page">
      <header className="customer-header">
        <div>
          <p>{table?.name}</p>
          <h1>Gọi món</h1>
        </div>
        <span>{phone}</span>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="menu-layout">
        <div className="menu-list">
          {categories.map((category) => (
            <section key={category.id} className="menu-section">
              <h2>{category.name}</h2>
              <div className="menu-grid">
                {category.items.map((item) => (
                  <article className="menu-card" key={item.id}>
                    <img src={item.imageUrl || 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=600&q=80'} alt="" />
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      <strong>{money(item.price)}</strong>
                    </div>
                    <div className="stepper">
                      <button aria-label="Giảm" onClick={() => changeQuantity(item.id, -1)}><Minus size={16} /></button>
                      <span>{cart[item.id] || 0}</span>
                      <button aria-label="Tăng" onClick={() => changeQuantity(item.id, 1)}><Plus size={16} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="cart-panel">
          <h2>Đơn hiện tại</h2>
          {cartLines.length === 0 && <p className="muted">Chưa chọn món.</p>}
          {cartLines.map((line) => (
            <div className="cart-line" key={line.item.id}>
              <span>{line.quantity} x {line.item.name}</span>
              <b>{money(line.item.price * line.quantity)}</b>
            </div>
          ))}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú cho quán" />
          <div className="cart-total"><span>Tổng</span><strong>{money(total)}</strong></div>
          <button className="primary" disabled={!cartLines.length} onClick={submitOrder}>Gọi món</button>
        </aside>
      </section>

      <section className="history">
        <div id="customer-history" className="section-title">
          <h2>Đơn đã gọi</h2>
          <span>{history.length} đơn</span>
        </div>
        <div className="history-list">
          {history.length === 0 && <p className="muted">Chưa có đơn nào từ số điện thoại này.</p>}
          {history.map((order) => (
            <article className="history-card" key={order.id}>
              <OrderRow order={order} />
              <div className="order-items">
                {order.items.map((item) => <span key={item.id}>{item.quantity} x {item.name}</span>)}
              </div>
              {order.status === 'NEW' && (
                <button className="danger-soft" onClick={() => cancelCustomerOrder(order.id)}>
                  <Trash2 size={16} /> Hủy đơn đang chờ
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      {paymentChoiceOpen && draftOrder && (
        <div className="modal-backdrop">
          <section className="success-modal">
            <ReceiptText size={42} />
            <h2>Chọn hình thức thanh toán</h2>
            <p>Đơn chỉ được tạo ngay nếu bạn chọn tiền mặt. Nếu chọn chuyển khoản, hệ thống sẽ chờ ngân hàng xác nhận rồi mới tạo đơn.</p>
            <div className="modal-actions">
              <button className="primary" onClick={chooseCashPayment}>Tiền mặt</button>
              <button onClick={chooseTransferPayment}>Chuyển khoản</button>
            </div>
          </section>
        </div>
      )}

      {transferIntent && (
        <div className="modal-backdrop">
          <section className="success-modal">
            <QrCode size={42} />
            <h2>Quét mã QR để chuyển khoản</h2>
            <p>Quét mã bên dưới để thanh toán đúng số tiền. Khi tiền về tài khoản, hệ thống mới hiển thị đặt món thành công và tạo đơn hàng.</p>
            {transferIntent.qrDataUrl && (
              <div className="payment-qr-box">
                <img className="pay-qr" src={transferIntent.qrDataUrl} alt="SePay QR" />
                <p>Sau khi ngân hàng xác nhận giao dịch, đơn hàng mới được tạo.</p>
              </div>
            )}
            <div className="modal-actions">
              <button className="button-link primary-link" onClick={downloadTransferQr}><Download size={16} /> Tải ảnh</button>
              <button className="danger-soft" onClick={cancelTransferPayment}>Cancel</button>
            </div>
          </section>
        </div>
      )}

      {successPopup && (
        <div className="modal-backdrop">
          <section className="success-modal">
            <Check size={42} />
            <h2>Gọi món thành công</h2>
            <p>{successPopup.kind === 'cash'
              ? `Đơn #${successPopup.order.dailySequence} đã được tạo ngay bằng tiền mặt.`
              : `Đơn #${successPopup.order.dailySequence} chỉ được tạo sau khi ngân hàng xác nhận chuyển khoản thành công.`}</p>
            <div className="modal-actions">
              <button className="primary" onClick={showOrders}>Xem đơn hàng</button>
              <button onClick={() => setSuccessPopup(null)}>Tiếp tục gọi món</button>
            </div>
          </section>
        </div>
      )}

      {infoPopup && (
        <div className="modal-backdrop">
          <section className="success-modal">
            <ReceiptText size={42} />
            <h2>{infoPopup.title}</h2>
            <p>{infoPopup.body}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setInfoPopup(null)}>Đóng</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function PaymentResult() {
  return (
    <main className="result-page">
      <ReceiptText size={48} />
      <h1>Đã quay lại từ cổng thanh toán</h1>
      <p>Quán sẽ nhận trạng thái chính thức từ webhook SePay. Nếu ngân hàng đã báo thành công, đơn sẽ tự chuyển sang đang làm.</p>
      <a href="/">Về trang chính</a>
    </main>
  );
}

function BackOffice() {
  const [user, setUser] = useState(getUser());
  if (!user) return <Login onLogin={setUser} />;
  return <DashboardShell user={user} onLogout={() => { logout(); setUser(null); }} onUserChange={setUser} />;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@vanmerchant.local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    try {
      const session = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setSession(session);
      onLogin(session.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <ChefHat size={40} />
        <h1>VanMerchant POS</h1>
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Mật khẩu" />
        {error && <p className="error">{error}</p>}
        <button type="submit">Đăng nhập</button>
      </form>
    </main>
  );
}

function DashboardShell({ user, onLogout, onUserChange }) {
  const canManageAccounts = ['OWNER', 'ADMIN'].includes(user.role);
  const tabs = canManageAccounts
    ? ['overview', 'orders', 'delivery', 'history', 'menu', 'ingredients', 'tables', 'accounts']
    : ['orders', 'delivery', 'history'];
  const [tab, setTab] = useState(tabs[0]);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Store /> <span>VanMerchant</span></div>
        <NavButton id="overview" tab={tab} setTab={setTab} hidden={!tabs.includes('overview')} icon={<BarChart3 />} label="Doanh thu" />
        <NavButton id="orders" tab={tab} setTab={setTab} icon={<ClipboardList />} label="Bill đang làm" />
        <NavButton id="delivery" tab={tab} setTab={setTab} icon={<ReceiptText />} label="Bill chờ giao" />
        <NavButton id="history" tab={tab} setTab={setTab} icon={<History />} label="Lịch sử đơn" />
        <NavButton id="menu" tab={tab} setTab={setTab} hidden={!tabs.includes('menu')} icon={<Utensils />} label="Menu" />
        <NavButton id="ingredients" tab={tab} setTab={setTab} hidden={!tabs.includes('ingredients')} icon={<Package />} label="Nguyên liệu" />
        <NavButton id="tables" tab={tab} setTab={setTab} hidden={!tabs.includes('tables')} icon={<QrCode />} label="Bàn & QR" />
        <NavButton id="accounts" tab={tab} setTab={setTab} hidden={!tabs.includes('accounts')} icon={<Users />} label="Tài khoản" />
        <button className="nav logout" onClick={onLogout}><LogOut /> Đăng xuất</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p>{user.role}</p><h1>{user.name}</h1></div>
          <button onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw size={16} /> Làm mới</button>
        </header>
        {tab === 'overview' && <Overview refreshToken={refreshToken} />}
        {tab === 'orders' && <Orders title="Bill đang làm" statuses={['NEW', 'PREPARING']} user={user} refreshToken={refreshToken} />}
        {tab === 'delivery' && <Orders title="Bill chờ giao" statuses={['DELIVERING']} user={user} emptyText="Chưa có bill nào chờ giao." refreshToken={refreshToken} />}
        {tab === 'history' && <Orders title="Lịch sử đơn hàng" user={user} emptyText="Chưa có lịch sử đơn." refreshToken={refreshToken} />}
        {tab === 'menu' && <MenuManager refreshToken={refreshToken} />}
        {tab === 'ingredients' && <IngredientManager refreshToken={refreshToken} />}
        {tab === 'tables' && <TableManager refreshToken={refreshToken} />}
        {tab === 'accounts' && <AccountManager currentUser={user} onCurrentUserChange={onUserChange} refreshToken={refreshToken} onLogout={onLogout} />}
      </section>
    </main>
  );
}

function NavButton({ id, tab, setTab, icon, label, hidden }) {
  if (hidden) return null;
  return <button className={`nav ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{icon}{label}</button>;
}

function Overview({ refreshToken }) {
  const [data, setData] = useState(null);
  const load = () => { api('/api/admin/dashboard').then(setData); };
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['dashboard', 'orders', 'ingredients'], load);
  if (!data) return <p>Đang tải...</p>;

  return (
    <div className="panel-stack">
      <div className="metric-grid">
        <Metric label="Doanh thu" value={money(data.revenue)} />
        <Metric label="Cost" value={money(data.cost)} />
        <Metric label="Lãi gộp" value={money(data.profit)} />
        <Metric label="Số đơn" value={data.orderCount} />
      </div>
      <section className="data-panel">
        <h2>Đơn gần đây</h2>
        {data.recentOrders.map((order) => <OrderRow key={order.id} order={order} compact />)}
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Orders({ title = 'Bill đang làm', statuses, emptyText = 'Chưa có bill.', user, refreshToken }) {
  const [orders, setOrders] = useState([]);
  const statusQuery = statuses?.length ? `?status=${statuses.join(',')}` : '';
  const load = () => api(`/api/orders${statusQuery}`).then(setOrders);
  useEffect(() => { load(); }, [statusQuery, refreshToken]);
  useRealtimeUpdates(['orders', 'dashboard'], load);

  async function update(id, patch) {
    await api(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify(patch) });
    load();
  }

  return (
    <section className="data-panel">
      <h2>{title}</h2>
      <div className="orders-grid">
        {orders.length === 0 && <p className="muted">{emptyText}</p>}
        {orders.map((order) => (
          <article className="order-card" key={order.id}>
            <OrderRow order={order} />
            <div className="order-items">
              {order.items.map((item) => <span key={item.id}>{item.quantity} x {item.name}</span>)}
            </div>
            <div className="order-actions">
              <button onClick={() => update(order.id, { status: 'PREPARING' })}><ChefHat size={16} /> Đang làm</button>
              <button onClick={() => update(order.id, { status: 'DELIVERING' })}><ReceiptText size={16} /> Đang giao</button>
              <button onClick={() => update(order.id, { status: 'DELIVERED' })}><Check size={16} /> Đã giao</button>
              {order.paymentStatus !== 'PAID' && <button onClick={() => update(order.id, { paymentStatus: 'PAID' })}><Banknote size={16} /> Đã thanh toán</button>}
              {['OWNER', 'ADMIN'].includes(user?.role) && order.status !== 'CANCELLED' && (
                <button className="danger-soft" onClick={() => update(order.id, { status: 'CANCELLED' })}>
                  <Trash2 size={16} /> Hủy đơn
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OrderRow({ order, compact }) {
  return (
    <div className={`order-row ${compact ? 'compact' : ''}`}>
      <b>#{order.dailySequence} - {order.table?.name}</b>
      <span>{money(order.subtotal)}</span>
      <Status text={order.status} />
      <Status text={order.paymentStatus} />
    </div>
  );
}

function Status({ text }) {
  return <span className={`status status-${String(text).toLowerCase()}`}>{text}</span>;
}

function MenuManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', price: 0, description: '', imageUrl: '' });
  const load = () => api('/api/admin/menu-items').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['menu'], load);

  function chooseImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, imageUrl: reader.result }));
    reader.readAsDataURL(file);
  }

  async function submit(event) {
    event.preventDefault();
    await api('/api/admin/menu-items', { method: 'POST', body: JSON.stringify({ ...form, price: Number(form.price) }) });
    setForm({ name: '', price: 0, description: '', imageUrl: '' });
    load();
  }

  return (
    <section className="data-panel">
      <h2>Menu</h2>
      <form className="menu-form" onSubmit={submit}>
        <label className="image-picker">
          {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <ImagePlus size={34} />}
          <input type="file" accept="image/*" onChange={chooseImage} />
          <span>Thêm ảnh món</span>
        </label>
        <div className="form-grid">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tên món" />
          <input value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="Giá bán" />
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Mô tả món" />
          <button type="submit"><Plus size={16} /> Thêm món</button>
        </div>
      </form>
      <div className="menu-admin-grid">
        {items.map((item) => (
          <article key={item.id} className="menu-admin-card">
            <img src={item.imageUrl || 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=600&q=80'} alt="" />
            <div>
              <b>{item.name}</b>
              <span>{money(item.price)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function IngredientManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', unit: 'g', stock: 0, minStock: 0, unitCost: 0 });
  const load = () => api('/api/admin/ingredients').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['ingredients'], load);

  async function submit(event) {
    event.preventDefault();
    await api('/api/admin/ingredients', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        stock: Number(form.stock),
        minStock: Number(form.minStock),
        unitCost: Number(form.unitCost)
      })
    });
    setForm({ name: '', unit: 'g', stock: 0, minStock: 0, unitCost: 0 });
    load();
  }

  return <CrudPanel title="Nguyên liệu" form={form} setForm={setForm} submit={submit} items={items} fields={['name', 'unit', 'stock', 'minStock', 'unitCost']} />;
}

function TableManager({ refreshToken }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', qrCode: '', seats: 4 });
  const load = () => api('/api/admin/tables').then(setItems);
  useEffect(() => { load(); }, [refreshToken]);
  useRealtimeUpdates(['tables'], load);

  async function submit(event) {
    event.preventDefault();
    await api('/api/admin/tables', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        qrCode: form.qrCode.trim() || undefined,
        seats: Number(form.seats)
      })
    });
    setForm({ name: '', qrCode: '', seats: 4 });
    load();
  }

  return (
    <section className="data-panel">
      <h2>Bàn & QR</h2>
      <form className="inline-form" onSubmit={submit}>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tên bàn" />
        <input value={form.qrCode} onChange={(event) => setForm({ ...form, qrCode: event.target.value })} placeholder="Mã QR tự sinh nếu bỏ trống" />
        <input value={form.seats} onChange={(event) => setForm({ ...form, seats: event.target.value })} placeholder="Số ghế" />
        <button type="submit"><Plus size={16} /> Thêm</button>
      </form>
      <div className="qr-table-list">
        {items.map((item) => (
          <article className="qr-table-card" key={item.id}>
            <img src={item.qrDataUrl} alt={`QR ${item.name}`} />
            <div>
              <h3>{item.name}</h3>
              <p>{item.qrCode}</p>
              <a href={item.orderUrl} target="_blank" rel="noreferrer">{item.orderUrl}</a>
              <div className="order-actions">
                <a className="button-link" href={item.orderUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Mở</a>
                <a className="button-link" href={item.qrDataUrl} download={`${item.qrCode}.png`}><Download size={16} /> Tải QR</a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AccountManager({ currentUser, onCurrentUserChange, refreshToken, onLogout }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' });

  const roleOptions = currentUser.role === 'ADMIN' ? ['STAFF', 'OWNER', 'ADMIN'] : ['STAFF', 'OWNER'];

  const load = () => {
    setError('');
    return api('/api/admin/users')
      .then(setUsers)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, [refreshToken]);
  useRealtimeUpdates(['users'], load);

  async function submit(event) {
    event.preventDefault();
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...form })
      });
      setForm({ name: '', email: '', password: '', role: 'STAFF' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="data-panel">
      <div className="section-title account-title">
        <div>
          <h2>Quản lý tài khoản</h2>
          <p className="muted">Tạo, đổi vai trò, cập nhật và xóa tài khoản nhân viên hoặc chủ cửa hàng.</p>
        </div>
        <span>{users.length} tài khoản</span>
      </div>

      <form className="account-create" onSubmit={submit}>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tên hiển thị" />
        <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email đăng nhập" />
        <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" placeholder="Mật khẩu mới" />
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <button type="submit"><Users size={16} /> Tạo tài khoản</button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="account-grid">
        {users.map((user) => (
          <UserCard
            key={user.id}
            user={user}
            currentUser={currentUser}
            roleOptions={roleOptions}
            onSaved={load}
            onDeleted={load}
            onCurrentUserChange={onCurrentUserChange}
            onLogout={onLogout}
          />
        ))}
      </div>
    </section>
  );
}

function UserCard({ user, currentUser, roleOptions, onSaved, onDeleted, onCurrentUserChange, onLogout }) {
  const locked = currentUser.role === 'OWNER' && user.role === 'ADMIN';
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    role: user.role,
    password: ''
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const formIsClean = form.name === user.name && form.email === user.email && form.role === user.role && form.password === '';
    if (formIsClean) {
      setForm({
        name: user.name,
        email: user.email,
        role: user.role,
        password: ''
      });
    }
  }, [user.id, user.name, user.email, user.role]);

  async function submit(event) {
    event.preventDefault();
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role
      };

      if (form.password.trim()) {
        payload.password = form.password;
      }

      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setError('');
      await onSaved();
      setForm((current) => ({ ...current, password: '' }));

      if (user.id === currentUser.id) {
        if (payload.role !== currentUser.role) {
          onLogout();
          return;
        }

        const nextCurrentUser = { ...currentUser, name: payload.name, email: payload.email, role: payload.role };
        updateStoredUser(nextCurrentUser);
        onCurrentUserChange(nextCurrentUser);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Xóa tài khoản ${user.email}?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      await onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <article className={`user-card ${locked ? 'locked' : ''}`}>
      <div className="user-card-header">
        <div>
          <b>{user.name}</b>
          <p>{user.email}</p>
        </div>
        <span className={`status status-${String(user.role).toLowerCase()}`}>{user.role}</span>
      </div>

      <form className="user-card-form" onSubmit={submit}>
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={locked} placeholder="Tên" />
        <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={locked} placeholder="Email" />
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} disabled={locked}>
          {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} disabled={locked} type="password" placeholder="Đặt lại mật khẩu" />
        <div className="order-actions">
          <button type="submit" disabled={locked}><Users size={16} /> Lưu</button>
          <button type="button" className="danger-soft" onClick={remove} disabled={locked || user.id === currentUser.id}><Trash2 size={16} /> Xóa</button>
        </div>
      </form>

      {locked && <p className="muted">Tài khoản admin chỉ có thể thao tác bởi admin cấp cao hơn.</p>}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

function CrudPanel({ title, form, setForm, submit, items, fields }) {
  return (
    <section className="data-panel">
      <h2>{title}</h2>
      <form className="inline-form" onSubmit={submit}>
        {fields.map((field) => (
          <input key={field} value={form[field] ?? ''} onChange={(event) => setForm({ ...form, [field]: event.target.value })} placeholder={field} />
        ))}
        <button type="submit"><Plus size={16} /> Thêm</button>
      </form>
      <div className="table-list">
        {items.map((item) => (
          <article key={item.id}>
            <b>{item.name}</b>
            <span>{item.price ? money(item.price) : item.qrCode || `${item.stock} ${item.unit}`}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
