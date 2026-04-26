// routes/admin.js —— 站长后台接口
const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
// 所有路由都需管理员权限
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/stats —— 数据面板 ─────────
router.get('/stats', async (req, res) => {
  const [
    { count: totalUsers },
    { count: totalAnime },
    { count: todayLogins },
    { count: totalComments },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('anime').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    supabase.from('logs')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'info')
      .ilike('message', '%登录%')
      .gte('created_at', new Date().toISOString().slice(0, 10)),
    supabase.from('comments').select('*', { count: 'exact', head: true }).eq('deleted', false),
  ]);

  // 今日总播放量（从 watch_history 统计）
  const { count: todayPlays } = await supabase
    .from('watch_history')
    .select('*', { count: 'exact', head: true })
    .gte('watched_at', new Date().toISOString().slice(0, 10));

  res.json({
    totalUsers,
    totalAnime,
    todayLogins,
    totalComments,
    todayPlays,
  });
});

// ── GET /api/admin/users —— 用户列表 ─────────
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabase
    .from('users')
    .select('id, username, email, role, banned, created_at, last_login', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (search) query = query.ilike('username', `%${search}%`);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: '获取用户列表失败' });

  res.json({
    data,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: count },
  });
});

// ── PATCH /api/admin/users/:id/ban —— 封禁/解禁
router.patch('/users/:id/ban', async (req, res) => {
  const { banned } = req.body;
  const { data: target } = await supabase
    .from('users')
    .select('username, role')
    .eq('id', req.params.id)
    .single();

  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.role === 'admin') {
    return res.status(403).json({ error: '不能封禁管理员账号' });
  }

  await supabase
    .from('users')
    .update({ banned: !!banned })
    .eq('id', req.params.id);

  await supabase.from('logs').insert({
    type: 'warn',
    message: `${banned ? '封禁' : '解禁'}用户: ${target.username}`,
    user_id: req.user.id,
  });

  res.json({ message: `已${banned ? '封禁' : '解禁'} ${target.username}` });
});

// ── DELETE /api/admin/users/:id —— 删除用户 ─
router.delete('/users/:id', async (req, res) => {
  const { data: target } = await supabase
    .from('users').select('username').eq('id', req.params.id).single();

  if (!target) return res.status(404).json({ error: '用户不存在' });

  // 软删除：标记为 banned，保留数据
  await supabase.from('users').update({ banned: true, deleted: true }).eq('id', req.params.id);

  await supabase.from('logs').insert({
    type: 'warn',
    message: `删除用户: ${target.username}`,
    user_id: req.user.id,
  });

  res.json({ message: '已删除' });
});

// ── GET /api/admin/comments —— 评论列表 ──────
router.get('/comments', async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { data, count, error } = await supabase
    .from('comments')
    .select(`
      id, content, created_at, deleted,
      users ( username ),
      anime ( title )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (error) return res.status(500).json({ error: '获取评论失败' });
  res.json({ data, pagination: { page: parseInt(page), limit: parseInt(limit), total: count } });
});

// ── GET /api/admin/logs —— 系统日志 ──────────
router.get('/logs', async (req, res) => {
  const { page = 1, limit = 50, type } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabase
    .from('logs')
    .select('id, type, message, created_at, users ( username )', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (type) query = query.eq('type', type);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: '获取日志失败' });
  res.json({ data, pagination: { page: parseInt(page), limit: parseInt(limit), total: count } });
});

// ── POST /api/admin/anime/:id/recommend —— 设置推荐位
router.post('/anime/:id/recommend', async (req, res) => {
  const { badge } = req.body; // hot | new | rec | null
  await supabase.from('anime').update({ badge }).eq('id', req.params.id);
  await supabase.from('logs').insert({
    type: 'info',
    message: `设置推荐位 ${badge} → 动漫 #${req.params.id}`,
    user_id: req.user.id,
  });
  res.json({ message: '推荐位已更新' });
});

module.exports = router;
