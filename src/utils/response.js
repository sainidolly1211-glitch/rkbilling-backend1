/** Standard success envelope. */
export const ok = (res, data, meta = undefined, status = 200) =>
  res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = (res, data, meta) => ok(res, data, meta, 201);

/**
 * Parse common list query params (pagination, sorting, search) into a
 * normalized object used by controllers.
 */
export function parseListQuery(query, { defaultSort = 'created_at', maxLimit = 100 } = {}) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), maxLimit);
  const sort = (query.sort || defaultSort).replace(/[^a-zA-Z0-9_]/g, '');
  const order = (query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const search = (query.search || '').trim();
  return {
    page,
    limit,
    sort,
    order,
    search,
    from: (page - 1) * limit,
    to: page * limit - 1,
  };
}

export const buildMeta = ({ page, limit, count }) => ({
  page,
  limit,
  total: count ?? 0,
  totalPages: count ? Math.ceil(count / limit) : 0,
});
