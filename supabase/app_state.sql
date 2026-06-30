-- Coze 部署持久化所需的通用 blob 表。
-- 在 Supabase 的 SQL 编辑器执行一次即可。
-- 应用会用两行：
--   key='local_store'    -> 阵容管理 / 联赛导入等全部可写数据
--   key='manual_records' -> 队伍ID工具的维护表

create table if not exists app_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 说明：应用使用 service role key 进行读写（绕过 RLS）。
-- 若你只用 anon key，请按需开启 RLS 并添加读写策略。
