// routes/auth.js —— 注册 / 登录 / 刷新
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 生成 JWT
function signToken(userId, role) {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── POST /api/auth/register ──────────────────
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: '请填写用户名、邮箱和密码' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  // 检查邮箱是否已注册
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: '该邮箱已被注册' });
  }

  // 加密密码
  const hashedPwd = await bcrypt.hash(password, 12);

  // 写入数据库
  const { data: user, error } = await supabase
    .from('users')
    .insert({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password_hash: hashedPwd,
      role: 'user',
      banned: false,
    })
    .select('id, username, email, role, avatar_url, created_at')
    .single();

  if (error) {
    console.error('注册失败:', error);
    return res.status(500).json({ error: '注册失败，请稍后重试' });
  }

  // 写入操作日志
  await supabase.from('logs').insert({
    type: 'info',
    message: `新用户注册: ${user.username}`,
    user_id: user.id,
  });

  const token = signToken(user.id, user.role);
  res.status(201).json({ token, user });
});

// ── POST /api/auth/login ─────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: '请填写邮箱和密码' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, email, role, avatar_url, banned, password_hash')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  if (user.banned) {
    return res.status(403).json({ error: '账号已被封禁，请联系管理员' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  // 更新最后登录时间
  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id);

  // 写入日志
  await supabase.from('logs').insert({
    type: 'info',
    message: `用户登录: ${user.username}`,
    user_id: user.id,
  });

  const { password_hash, ...safeUser } = user;
  const token = signToken(user.id, user.role);
  res.json({ token, user: safeUser });
});

// ── GET /api/auth/me ─────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/logout ────────────────────
// JWT 无状态，客户端删除 token 即可，此接口记录日志
router.post('/logout', requireAuth, async (req, res) => {
  await supabase.from('logs').insert({
    type: 'info',
    message: `用户退出: ${req.user.username}`,
    user_id: req.user.id,
  });
  res.json({ message: '已退出登录' });
});

module.exports = router;
