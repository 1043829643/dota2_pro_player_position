# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **Database**: Supabase (PostgreSQL) + Drizzle ORM
- **Auth**: 无登录系统（公开读写）

## 项目概述

战队阵容管理器 — 引导式管理每场比赛、每支战队的 1~5 号位选手阵容。

核心流程：选择比赛 → 选择战队 → 编辑阵容 → 保存 → 继续下一队 / 导出

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── tournaments/          # 比赛 CRUD + 统计
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts      # GET/PUT/DELETE 单场比赛
│   │   │   │       └── teams/
│   │   │   │           └── route.ts  # GET/POST 比赛下战队
│   │   │   ├── teams/[id]/
│   │   │   │   ├── route.ts          # GET/PUT/DELETE 单支战队
│   │   │   │   └── players/
│   │   │   │       └── route.ts      # GET/POST 战队下选手
│   │   │   ├── players/[id]/
│   │   │   │   └── route.ts          # PUT/DELETE 单个选手
│   │   │   └── export/
│   │   │       └── route.ts          # GET CSV 导出
│   │   ├── tournament/[id]/page.tsx   # 战队列表页
│   │   ├── team/[id]/page.tsx         # 阵容编辑页
│   │   ├── page.tsx                   # 首页（比赛列表）
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/
│   ├── lib/
│   │   └── utils.ts
│   ├── storage/database/
│   │   ├── shared/schema.ts           # Drizzle 表定义 + Zod 校验
│   │   └── supabase-client.ts         # Supabase 客户端
│   └── server.ts
├── next.config.ts
├── package.json
└── tsconfig.json
```

## 数据库表结构

### tournaments（比赛）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial PK | 主键 |
| name | varchar(255) | 比赛名 |
| league_id | varchar(128) | 联赛标识 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### teams（战队）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial PK | 主键 |
| tournament_id | integer FK | 所属比赛 (cascade delete) |
| name | varchar(255) | 战队名 |
| short_name | varchar(64) | 简称 |
| team_id | varchar(128) | 外部标识 |
| status | varchar(32) | 完整/缺失/重复/待确认 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### players（选手）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial PK | 主键 |
| team_id | integer FK | 所属战队 (cascade delete) |
| nickname | varchar(128) | 昵称 |
| steamid64 | varchar(32) | Steam 64位ID |
| position | integer | 1~5号位 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

## API 路由总结

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/tournaments | 获取所有比赛（含战队数和阵容完成度） |
| POST | /api/tournaments | 创建比赛 |
| GET | /api/tournaments/[id] | 获取单场比赛 |
| PUT | /api/tournaments/[id] | 更新比赛 |
| DELETE | /api/tournaments/[id] | 删除比赛 |
| GET | /api/tournaments/[id]/teams | 获取比赛下所有战队（含选手摘要） |
| POST | /api/tournaments/[id]/teams | 在比赛下创建战队 |
| GET | /api/teams/[id] | 获取单支战队 |
| PUT | /api/teams/[id] | 更新战队 |
| DELETE | /api/teams/[id] | 删除战队 |
| GET | /api/teams/[id]/players | 获取战队下所有选手 |
| POST | /api/teams/[id]/players | 为战队添加选手 |
| PUT | /api/players/[id] | 更新选手 |
| DELETE | /api/players/[id] | 删除选手 |
| GET | /api/export?scope=all\|tournament&id=N | 导出 CSV |

## 包管理规范

- **仅允许使用 pnpm**，严禁使用 npm 或 yarn

## 开发规范

### 编码规范
- 默认按 TypeScript `strict` 心智写代码
- 禁止隐式 `any` 和 `as any`
- Supabase SDK 必须检查 `{ data, error }` 并 throw

### Hydration 问题防范
- 所有交互页面均使用 `"use client"`
- 动态数据必须通过 useEffect + useState 在客户端渲染

## 关键业务规则（保存校验）

保存阵容时校验：
1. 5 个位置是否都有选手
2. steamid64 是否为 17 位数字
3. 同一位置是否有重复选手
4. STRATZ 链接基于 steamid64 自动生成

## 页面路由

| 路径 | 页面 | 功能 |
|------|------|------|
| / | 首页 | 比赛卡片列表 + 创建/删除比赛 |
| /tournament/[id] | 战队列表 | 比赛下战队卡片 + 创建/删除战队 |
| /team/[id] | 阵容编辑 | 选手卡片网格 + 编辑/添加/删除 + 保存校验 + 成功引导 |