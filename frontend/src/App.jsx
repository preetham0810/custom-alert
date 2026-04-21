import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const BACKEND = import.meta.env.VITE_BACKEND_URL || window.location.origin;

function useIOSInstallBanner() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.navigator.standalone === true;
  const [show, setShow] = useState(isIOS && !isInStandalone);
  return [show, () => setShow(false)];
}

function IOSInstallBanner({ onDismiss }) {
  return (
    <div style={{
      background: '#1e40af', color: '#fff', padding: '12px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: '13px', gap: '12px'
    }}>
      <span>
        Install this app: tap <strong>Share</strong> then <strong>"Add to Home Screen"</strong>
      </span>
      <button onClick={onDismiss} style={{
        background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
        color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer'
      }}>Dismiss</button>
    </div>
  );
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function playAlertSound(severity) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const isP1 = severity === 'P1';
  const beeps = isP1 ? 3 : 1;
  const freq = isP1 ? 880 : 660;

  for (let i = 0; i < beeps; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.25);
    osc.start(ctx.currentTime + i * 0.35);
    osc.stop(ctx.currentTime + i * 0.35 + 0.25);
  }
}

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const { key } = await fetch('/api/vapid-public-key').then(r => r.json());
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return Promise.resolve('denied');
  return registerPush();
}

function sendBrowserNotification(alert) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(`${alert.severity} — ${alert.title}`, {
    body: alert.description,
    icon: '/favicon.ico',
    tag: alert.id,
    requireInteraction: alert.severity === 'P1',
  });
  n.onclick = () => window.focus();
}

export default function App() {
  const [alerts, setAlerts] = useState([]);
  const [oncall, setOncall] = useState({ name: 'Loading…', email: '' });
  const [connected, setConnected] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(Notification?.permission === 'granted');
  const [showOncallModal, setShowOncallModal] = useState(false);
  const [oncallForm, setOncallForm] = useState({ name: '', email: '' });
  const [showIOSBanner, dismissIOSBanner] = useIOSInstallBanner();
  const [trigger, setTrigger] = useState({ severity: 'P1', title: '', description: '' });
  const socketRef = useRef(null);
  const prevAlertIds = useRef(new Set());

  // Listen for service worker push messages → play sound in background tab
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = event => {
      if (event.data?.type === 'PLAY_ALERT') {
        playAlertSound(event.data.severity);
        if (navigator.vibrate) {
          navigator.vibrate(event.data.severity === 'P1' ? [400,100,400,100,400] : [200,100,200]);
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const socket = io(BACKEND);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('alerts', incoming => {
      setAlerts(incoming);
      // Notify for new active alerts
      incoming.forEach(a => {
        if (a.status === 'active' && !prevAlertIds.current.has(a.id)) {
          playAlertSound(a.severity);
          sendBrowserNotification(a);
        }
      });
      prevAlertIds.current = new Set(incoming.map(a => a.id));
    });

    socket.on('oncall', data => setOncall(data));

    return () => socket.disconnect();
  }, []);

  async function enableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifEnabled(perm === 'granted');
  }

  async function fireTrigger() {
    const payload = {
      severity: trigger.severity,
      title: trigger.title || `${trigger.severity} Test Alert`,
      description: trigger.description || 'Mock alert triggered from dashboard',
      source: 'manual',
    };
    await fetch(`${BACKEND}/api/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setTrigger(t => ({ ...t, title: '', description: '' }));
  }

  async function ackAlert(id) {
    await fetch(`${BACKEND}/api/alerts/${id}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: oncall.name }),
    });
  }

  async function resolveAlert(id) {
    await fetch(`${BACKEND}/api/alerts/${id}/resolve`, { method: 'POST' });
  }

  async function saveOncall() {
    await fetch(`${BACKEND}/api/oncall`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(oncallForm),
    });
    setShowOncallModal(false);
  }

  const p1Active    = alerts.filter(a => a.severity === 'P1' && a.status === 'active').length;
  const p2Active    = alerts.filter(a => a.severity === 'P2' && a.status === 'active').length;
  const ackCount    = alerts.filter(a => a.status === 'acknowledged').length;
  const resolvedCount = alerts.filter(a => a.status === 'resolved').length;
  const openAlerts  = alerts.filter(a => a.status !== 'resolved');
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved');

  return (
    <>
      {showIOSBanner && <IOSInstallBanner onDismiss={dismissIOSBanner} />}

      {/* Header */}
      <div className="header">
        <div className="header-title">
          🚨 Alert System
        </div>
        <div className="header-right">
          <span className="conn-label">
            <span className={`conn-dot ${connected ? 'on' : 'off'}`} />
            {connected ? 'Live' : 'Disconnected'}
          </span>
          <button
            className={`notif-btn ${notifEnabled ? 'enabled' : ''}`}
            onClick={enableNotifications}
          >
            {notifEnabled ? '🔔 Notifications On' : '🔕 Enable Notifications'}
          </button>
          <span
            className="oncall-badge"
            onClick={() => { setOncallForm({ name: oncall.name, email: oncall.email }); setShowOncallModal(true); }}
            title="Click to update on-call"
          >
            👤 On-Call: {oncall.name}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="stats">
        <div className="stat-card p1">
          <div className="stat-num">{p1Active}</div>
          <div className="stat-label">Active P1</div>
        </div>
        <div className="stat-card p2">
          <div className="stat-num">{p2Active}</div>
          <div className="stat-label">Active P2</div>
        </div>
        <div className="stat-card ack">
          <div className="stat-num">{ackCount}</div>
          <div className="stat-label">Acknowledged</div>
        </div>
        <div className="stat-card resolved">
          <div className="stat-num">{resolvedCount}</div>
          <div className="stat-label">Resolved</div>
        </div>
      </div>

      {/* Trigger Panel */}
      <div className="trigger-panel">
        <h3>🧪 Trigger Test Alert</h3>
        <div className="trigger-row">
          <select value={trigger.severity} onChange={e => setTrigger(t => ({ ...t, severity: e.target.value }))}>
            <option>P1</option>
            <option>P2</option>
          </select>
          <input
            placeholder="Title (optional)"
            value={trigger.title}
            onChange={e => setTrigger(t => ({ ...t, title: e.target.value }))}
          />
          <input
            placeholder="Description (optional)"
            value={trigger.description}
            onChange={e => setTrigger(t => ({ ...t, description: e.target.value }))}
          />
          <button className="btn btn-fire" onClick={fireTrigger}>
            Fire Alert
          </button>
        </div>
      </div>

      {/* Active / Acknowledged Alerts */}
      <div className="alerts-section">
        <h3>Active &amp; Acknowledged ({openAlerts.length})</h3>

        {openAlerts.length === 0 && (
          <div className="empty-state">
            <div className="icon">✅</div>
            <div>All clear — no active alerts</div>
          </div>
        )}

        {openAlerts.map(alert => (
          <AlertCard key={alert.id} alert={alert} onAck={ackAlert} onResolve={resolveAlert} />
        ))}
      </div>

      {/* Resolved */}
      {resolvedAlerts.length > 0 && (
        <div className="alerts-section">
          <h3>Resolved ({resolvedAlerts.length})</h3>
          {resolvedAlerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} onAck={ackAlert} onResolve={resolveAlert} />
          ))}
        </div>
      )}

      {/* On-Call Edit Modal */}
      {showOncallModal && (
        <div className="modal-overlay" onClick={() => setShowOncallModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit On-Call Person</h3>
            <label>Name</label>
            <input
              value={oncallForm.name}
              onChange={e => setOncallForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Full name"
            />
            <label>Email</label>
            <input
              value={oncallForm.email}
              onChange={e => setOncallForm(f => ({ ...f, email: e.target.value }))}
              placeholder="email@company.com"
            />
            <div className="modal-actions">
              <button className="btn btn-cancel" onClick={() => setShowOncallModal(false)}>Cancel</button>
              <button className="btn btn-save" onClick={saveOncall}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AlertCard({ alert, onAck, onResolve }) {
  const cardClass = ['alert-card', alert.severity, alert.status].join(' ');

  return (
    <div className={cardClass}>
      <div className="alert-top">
        <div className="alert-left">
          <span className={`severity-badge ${alert.severity}`}>{alert.severity}</span>
          <div>
            <div className="alert-title">{alert.title}</div>
            <div className="alert-meta">
              {alert.source} · {timeAgo(alert.createdAt)}
              {alert.acknowledgedBy && ` · Acked by ${alert.acknowledgedBy}`}
            </div>
          </div>
        </div>
        <span className={`status-pill ${alert.status}`}>{alert.status}</span>
      </div>

      {alert.description && (
        <div className="alert-desc">{alert.description}</div>
      )}

      <div className="alert-actions">
        {alert.status === 'active' && (
          <button className="btn btn-ack" onClick={() => onAck(alert.id)}>Acknowledge</button>
        )}
        {alert.status !== 'resolved' && (
          <button className="btn btn-resolve" onClick={() => onResolve(alert.id)}>Resolve</button>
        )}
      </div>
    </div>
  );
}
