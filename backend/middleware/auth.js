// middleware/auth.js —— JWT 验证中间件
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');

// 验证 JWT Token，注入 req.user
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // 从数据库获取最新用户状态（检查是否被封禁）
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, role, banned')
      .eq('id', payload.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    if (user.banned) {
      return res.status(403).json({ error: '账号已被封禁，请联系管理员' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token 已过期，请重新登录' });
    }
    return res.status(401).json({ error: 'Token 无效' });
  }
}

// 仅管理员可访问
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员权限' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
