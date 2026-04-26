// routes/anime.js —— 动漫库 CRUD
const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/anime —— 动漫列表（分页+筛选）──
router.get('/', async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    badge,      // hot | new | rec
    search,
    sort = 'created_at', // score | views | created_at
    order = 'desc',
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabase
    .from('anime')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .range(offset, offset + parseInt(limit) - 1)
    .order(sort, { ascending: order === 'asc' });

  if (category) query = query.contains('tags', [category]);
  if (badge)    query = query.eq('badge', badge);
  if (search)   query = query.ilike('title', `%${search}%`);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: '获取动漫列表失败' });

  res.json({
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      totalPages: Math.ceil(count / parseInt(limit)),
    },
  });
});

// ── GET /api/anime/:id —— 动漫详情 ──────────
router.get('/:id', async (req, res) => {
  const { data: anime, error } = await supabase
    .from('anime')
    .select('*')
    .eq('id', req.params.id)
    .eq('status', 'published')
    .single();

  if (error || !anime) {
    return res.status(404).json({ error: '动漫不存在' });
  }

  // 播放量 +1
  await supabase
    .from('anime')
    .update({ views: anime.views + 1 })
    .eq('id', anime.id);

  res.json(anime);
});

// ── GET /api/anime/:id/episodes —— 集数列表 ─
router.get('/:id/episodes', async (req, res) => {
  const { data, error } = await supabase
    .from('episodes')
    .select('id, episode_number, title, duration, video_url, thumbnail_url, created_at')
    .eq('anime_id', req.params.id)
    .order('episode_number', { ascending: true });

  if (error) return res.status(500).json({ error: '获取集数失败' });
  res.json(data);
});

// ── POST /api/anime —— 添加动漫（仅管理员）─
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, tags, badge, cover_url, year, total_episodes } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: '标题和简介不能为空' });
  }

  const { data, error } = await supabase
    .from('anime')
    .insert({
      title, description, tags: tags || [],
      badge: badge || 'new',
      cover_url, year: year || new Date().getFullYear(),
      total_episodes: total_episodes || 0,
      score: 0, views: 0, status: 'published',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: '添加失败' });

  await supabase.from('logs').insert({
    type: 'info',
    message: `管理员添加动漫: ${title}`,
    user_id: req.user.id,
  });

  res.status(201).json(data);
});

// ── PUT /api/anime/:id —— 编辑动漫（仅管理员）
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const allowed = ['title','description','tags','badge','cover_url','year','total_episodes','status'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data, error } = await supabase
    .from('anime')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: '更新失败' });
  res.json(data);
});

// ── DELETE /api/anime/:id —— 删除动漫（仅管理员）
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from('anime')
    .update({ status: 'deleted' })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: '删除失败' });
  res.json({ message: '已下架' });
});

// ── POST /api/anime/:id/favorite —— 收藏 ────
router.post('/:id/favorite', requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('anime_id', req.params.id)
    .maybeSingle();

  if (existing) {
    await supabase.from('favorites').delete().eq('id', existing.id);
    return res.json({ favorited: false });
  }

  await supabase.from('favorites').insert({
    user_id: req.user.id,
    anime_id: req.params.id,
  });
  res.json({ favorited: true });
});

// ── GET /api/anime/:id/favorite —— 查收藏状态
router.get('/:id/favorite', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('anime_id', req.params.id)
    .maybeSingle();

  res.json({ favorited: !!data });
});

// ── POST /api/anime/:id/rate —— 评分 ─────────
router.post('/:id/rate', requireAuth, async (req, res) => {
  const { score } = req.body;
  if (!score || score < 1 || score > 10) {
    return res.status(400).json({ error: '评分须在1-10之间' });
  }

  await supabase.from('ratings').upsert({
    user_id: req.user.id,
    anime_id: req.params.id,
    score: parseInt(score),
  }, { onConflict: 'user_id,anime_id' });

  // 重新计算平均分
  const { data: ratings } = await supabase
    .from('ratings')
    .select('score')
    .eq('anime_id', req.params.id);

  if (ratings && ratings.length > 0) {
    const avg = ratings.reduce((s, r) => s + r.score, 0) / ratings.length;
    await supabase
      .from('anime')
      .update({ score: Math.round(avg * 10) / 10 })
      .eq('id', req.params.id);
  }

  res.json({ message: '评分成功', score });
});

module.exports = router;
