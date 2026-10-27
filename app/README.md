# 行测真题 Web

一个家庭内网用的行测刷题应用：考试模式 + 练习模式 + 错题本。题库直接读取仓库根目录的 Markdown，不需要手工导入。

## 技术栈

- 后端：Node 22 + Fastify 5 + better-sqlite3
- 前端：React 19 + Vite 7 + TypeScript + 原生 CSS
- 数据：启动时 ETL 把 2,956 篇 Markdown 解析进 SQLite（约 8 秒），内容指纹不变则跳过

## 本地开发

```bash
cd app
npm install

# 终端 1：API（http://127.0.0.1:8090）
npm run dev:server

# 终端 2：Vite（http://127.0.0.1:5173，已代理 /api 和 /media）
npm run dev:web
```

默认 `CONTENT_DIR` 是仓库根目录，`DATA_DIR` 是 `<仓库>/data`。可以用环境变量覆盖：

```bash
CONTENT_DIR=/path/to/content DATA_DIR=/path/to/data npm run dev:server
```

## 构建与运行

```bash
npm run build          # 前端 dist/ + 服务端 dist-server/
npm start              # 生产模式，默认 8090
```

## 校验题库解析

```bash
npm run test:etl
```

会输出解析统计并断言黄金数字：

```text
2,956 篇笔记 / 515 套卷 / 58,890 题 / 27,473 个唯一 qid
判断 111 / 多选 405 / 不可判分 4 / 选项分布 2:111, 4:58737, 5:2, 8:40
```

解析器在 `server/parse.ts`。其中材料归属不是简单「材料之后的所有题」：

- 资料分析：材料后的小题直到下一份材料；
- 其他模块：结合显式「回答 X~Y 题」范围、qid 分块回退、题型切换和题干长度判断材料小组的边界，避免把阅读材料挂到后面的独立题上。

如果换了一整套题库，设置 `STRICT_ETL=0` 跳过黄金数字断言。

## 目录

```text
server/
  config.ts        端口 / 内容目录 / 数据目录
  db.ts            SQLite 建表与连接
  html.ts          Markdown -> 安全 HTML、图片路径改写
  parse.ts         Markdown 题库解析器
  etl.ts           指纹判断 + 内容表重建 + 黄金数字校验
  app.ts           全部 API 路由
  index.ts         Fastify 启动、静态资源、SPA fallback

src/
  pages/           首页、考试、练习、成绩、错题本
  components/      题目、选项、材料、答题卡、弹窗等
  api.ts           前端 API 客户端
  types.ts         共享类型
  styles.css       全站样式（含深色模式与手机端）
```

## 数据模型

内容表（可重建）：`papers` / `paper_modules` / `materials` / `questions` / `options` / `paper_questions`

用户表（持久）：`attempts` / `attempt_answers` / `practice_sessions` / `practice_answers` / `wrong_book` / `question_flags` / `profiles`

内容重建只 DROP 内容表，用户记录按 `paper_id` / `question_id` 保留。

错题本带 `correct_streak`：练习中连续答对 3 次会自动标记为已掌握，答错会清零。

## API 速览

```text
GET  /api/overview
GET  /api/filters
GET  /api/papers
GET  /api/papers/:id
POST /api/exams
GET  /api/exams/:id
GET  /api/exams/:id/questions      # 考试中不下发答案/解析
PATCH /api/exams/:id/answers
PATCH /api/exams/:id/flags
POST /api/exams/:id/submit
GET  /api/exams/:id/review
POST /api/practice
GET  /api/practice/:id
GET  /api/practice/:id/questions?offset=&limit=
PATCH /api/practice/:id/answers
POST /api/practice/:id/finish
GET  /api/practice/:id/review
GET  /api/wrong-book
PATCH /api/wrong-book/:questionId
DELETE /api/wrong-book/:questionId
GET  /api/stats
GET  /api/search?q=
GET  /api/question-flags
POST /api/question-flags
DELETE /api/question-flags/:questionId
```

练习支持 `paper / tag / custom / question / wrong` 五种来源；`question` 是搜索结果或疑问标记里的单题练习，`custom` 是多模块混合抽题。

所有用户数据接口都通过 `X-Profile-Id` 识别成员。界面右上角可以切换成员、添加家庭成员、改名和删除成员（软删除）。

每个成员拥有独立的考试记录、练习记录和错题本；题库共享。**这是数据分区，不是登录认证**：知道成员 ID 的人可以在 API 层切换，家庭内网使用没问题，公网部署请加反向代理认证。

## 官方解析与错因解析

原始题库的每题都有 `**官方解析**`（27,473/27,473 题，平均约 430 字），但它是自由文本，没有结构化的「A 项错因 / B 项错因」字段。

API 在返回练习和考试解析时，会从官方解析里按 `A项/B项/C项/D项` 拆出 `optionReasons`：

- 17,001 道题的解析提到了至少两个选项，13,259 道包含「排除」；
- 有逐项说明时，前端会显示「错因解析」：你选错的选项 + 正确选项各自的原因；
- 没有逐项说明时，只显示完整官方解析，不编造原因；
- 解析里的公式图片仍保留在完整解析中（错因段落是纯文本摘录）。

## 说明

- 考试模式服务端权威计时：`deadline_at` 固定，刷新/换设备继续，超时自动交卷。
- 多选题全对才得分；判断题 A=正确、B=错误；缺答案题不计分。
- 题目/解析 HTML 在 ETL 阶段预渲染并白名单过滤，前端不再执行 Markdown。
- 图片走 `/media/*`，带 30 天缓存；缺失图片使用占位 SVG。
