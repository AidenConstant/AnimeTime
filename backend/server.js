// ============================================
// AnimeTime 主服务器入口
// ============================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const animeRoutes = require('./routes/anime');
const commentRoutes = require('./routes/comments');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

// ── 安全中间件 ──────────────────────────────
app.use(helmet());

// CORS：只允许你的前端域名访问
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('不允许的跨域请求来源'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── 全局限流：防止暴力攻击 ──────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟窗口
  max: 200,
  message: { error: '请求过于频繁，请稍后再试' },
});
app.use(globalLimiter);

// 登录注册接口单独更严格限流
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登录/注册尝试次数过多，请15分钟后再试' },
});

// ── 路由挂载 ────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/anime', animeRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

// ── 健康检查 ────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AnimeTime API',
    time: new Date().toISOString(),
  });
});

// ── 404 处理 ────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// ── 全局错误处理 ────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? '服务器内部错误'
      : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`✅ AnimeTime 后端启动成功，端口: ${PORT}`);
  console.log(`📡 环境: ${process.env.NODE_ENV || 'development'}`);
});
