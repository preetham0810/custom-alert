const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// In-memory store — replace with DB for production
const alerts = [];
const oncall = { name: 'John Doe', email: 'john@company.com' };

function broadcastAlerts() {
  io.emit('alerts', alerts);
}

function createAlert({ severity, title, description, source }) {
  const alert = {
    id: uuidv4(),
    severity: severity || 'P2',
    title: title || `${severity} Incident`,
    description: description || 'Alert triggered',
    source: source || 'manual',
    status: 'active',
    createdAt: new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
  };
  alerts.unshift(alert);
  broadcastAlerts();
  console.log(`[ALERT] ${alert.severity} - ${alert.title}`);
  return alert;
}

// ── REST endpoints ──────────────────────────────────────────

app.get('/api/alerts', (_req, res) => res.json(alerts));

app.get('/api/oncall', (_req, res) => res.json(oncall));

app.put('/api/oncall', (req, res) => {
  const { name, email } = req.body;
  if (name) oncall.name = name;
  if (email) oncall.email = email;
  io.emit('oncall', oncall);
  res.json(oncall);
});

// ServiceNow webhook
app.post('/api/servicenow', (req, res) => {
  const b = req.body;

  // ServiceNow standard incident fields
  const priority = b.priority || b.u_priority || '';
  const severity = priority.includes('1') || priority.toLowerCase().includes('critical') ? 'P1' : 'P2';

  const alert = createAlert({
    severity,
    title: b.short_description || b.number || 'ServiceNow Incident',
    description: [b.description, b.assignment_group, b.number].filter(Boolean).join(' · '),
    source: 'servicenow',
  });

  res.json(alert);
});

// Manual / mock trigger
app.post('/api/trigger', (req, res) => {
  const alert = createAlert(req.body);
  res.json(alert);
});

// AWS SNS webhook
app.post('/api/sns', async (req, res) => {
  const body = req.body;

  if (body.Type === 'SubscriptionConfirmation') {
    const https = require('https');
    https.get(body.SubscribeURL, () => console.log('SNS subscription confirmed'));
    return res.json({ ok: true });
  }

  if (body.Type === 'Notification') {
    let message = {};
    try { message = JSON.parse(body.Message); } catch { /* raw */ }

    const severity = (message.AlarmName || '').toLowerCase().includes('p1') ? 'P1' : 'P2';
    createAlert({
      severity,
      title: message.AlarmName || body.Subject || 'CloudWatch Alert',
      description: message.NewStateReason || body.Message,
      source: 'aws-cloudwatch',
    });
    return res.json({ ok: true });
  }

  res.json({ ok: true });
});

app.post('/api/alerts/:id/ack', (req, res) => {
  const alert = alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'not found' });
  alert.status = 'acknowledged';
  alert.acknowledgedAt = new Date().toISOString();
  alert.acknowledgedBy = req.body.name || oncall.name;
  broadcastAlerts();
  res.json(alert);
});

app.post('/api/alerts/:id/resolve', (req, res) => {
  const alert = alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'not found' });
  alert.status = 'resolved';
  alert.resolvedAt = new Date().toISOString();
  broadcastAlerts();
  res.json(alert);
});

// ── WebSocket ───────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.emit('alerts', alerts);
  socket.emit('oncall', oncall);
});

// Serve built frontend in production
const path = require('path');
const fs = require('fs');
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
