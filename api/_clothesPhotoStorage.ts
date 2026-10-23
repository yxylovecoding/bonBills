// Discover referenced photos without transferring the photo bodies or whole
// history to the browser. All three KEYS are scoped by _accountKv.
export const READ_PHOTO_SIZES = `
local ids = {}
local function collect(item)
  if type(item.photoId) == 'string' and string.match(item.photoId, '^[%w-]+$') then ids[item.photoId] = true end
end
for _, raw in ipairs(redis.call('HVALS', KEYS[1])) do collect(cjson.decode(raw)) end
for _, raw in ipairs(redis.call('HVALS', KEYS[2])) do
  local record = cjson.decode(raw)
  for _, item in ipairs(record.items or {}) do collect(item) end
end
local result = {}
for id, _ in pairs(ids) do
  local bytes = redis.call('STRLEN', KEYS[3] .. id)
  if bytes > tonumber(ARGV[1]) then table.insert(result, {id, bytes}) end
end
return result
`;

// Keep the reference (including historical snapshots) and only replace an
// unchanged source with a smaller representation. Retry after success is a no-op.
export const COMPRESS_PHOTO = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {-1, 0} end
local photo = raw
if string.sub(photo, 1, 1) == '"' then photo = cjson.decode(photo) end
if #ARGV[2] >= #raw or photo == ARGV[2] then return {0, 0} end
if 'photo-v2-' .. redis.sha1hex(photo) ~= ARGV[1] then return {-2, 0} end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return {1, #raw - #ARGV[2]}
`;
