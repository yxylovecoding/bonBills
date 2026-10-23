// Read-only scripts: filter inside Redis so discarded photos/history never cross
// the Redis → API boundary. All keys still pass through _accountKv's scope.
export const READ_PHOTO = `
local photo = redis.call('GET', KEYS[1])
if not photo or photo == '' then return {'', ''} end
-- Historical SDK writes may be JSON strings; SAVE_CLOTHES writes raw data URLs.
if string.sub(photo, 1, 1) == '"' then photo = cjson.decode(photo) end
local etag = 'photo-v2-' .. redis.sha1hex(photo)
if string.sub(photo, 1, 1) == '{' then etag = cjson.decode(photo).validator end
for _, tag in ipairs(cjson.decode(ARGV[1])) do
  if tag == '"' .. etag .. '"' or tag == '*' then return {etag, ''} end
end
return {etag, photo}
`;

export const READ_WEAR_PAGE = `
local records = {}
local dates = {}
local seen = {}
for _, raw in ipairs(redis.call('HVALS', KEYS[1])) do
  local record = cjson.decode(raw)
  local include = false
  if ARGV[2] == 'day' then
    include = record.date == ARGV[1]
  else
    include = record.kind ~= 'styled' and record.date <= ARGV[1]
  end
  if include then
    table.insert(records, {date=record.date, raw=raw})
    if not seen[record.date] then
      seen[record.date] = true
      table.insert(dates, record.date)
    end
  end
end
table.sort(dates, function(a, b) return a > b end)
local cutoff = dates[math.min(30, #dates)]
local result = {}
for _, record in ipairs(records) do
  if record.date >= cutoff then table.insert(result, record.raw) end
end
return result
`;
