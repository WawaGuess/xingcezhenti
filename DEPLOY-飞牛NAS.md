# 部署到飞牛 NAS（fnOS）

这个目录同时是题库和 Web 应用。部署后可以在家里通过浏览器刷题，数据保存在 NAS 本地。

## 前置

- 飞牛 NAS 已安装 **Docker**（应用中心里的 Docker / Container Manager）。
- 把整个仓库放到 NAS 上，例如：

```text
/vol1/1000/docker/xingcezhenti/
├── 01-政治理论/
├── 02-常识判断/
├── 03-言语理解与表达/
├── 04-数量关系/
├── 05-判断推理/
├── 06-资料分析/
├── 90-图片/
├── app/
├── data/                  # 首次启动自动创建
├── Dockerfile
└── docker-compose.yml
```

> `data/` 是数据库目录，必须可写；题库目录只需要读权限。

## 部署

### 方式 A：SSH / 终端（推荐）

```bash
cd /vol1/1000/docker/xingcezhenti
docker compose up -d --build
```

首次构建会下载 Node 依赖并编译 `better-sqlite3`，视 NAS 性能需要几分钟；容器启动后第一次会解析题库，通常 10 秒左右。

查看日志：

```bash
docker logs -f xingce-web
```

看到类似下面的内容就说明题库已就绪：

```text
[etl] 重建完成 ...ms：515 套 / 58890 题 / 27473 唯一题 / 判断 111 / 多选 405 ...
行测真题 web 已启动：http://127.0.0.1:8090 ...
```

### 方式 B：飞牛 Docker 图形界面

1. 打开 NAS 的 **Docker** 应用。
2. 选择「项目 / Compose」→「新建」。
3. 项目目录选择仓库根目录（包含 `docker-compose.yml`）。
4. 使用现有 `docker-compose.yml`，构建并启动。
5. 等待容器状态变为运行中。

## 访问

在手机或电脑浏览器打开：

```text
http://NAS的局域网IP:8090
```

例如 `http://192.168.1.20:8090`。

手机浏览器可以「添加到主屏幕」，当作轻量 App 使用。

## 更新

### 只更新题库内容

替换 `01-...` 到 `06-...` 或 `90-图片/` 里的文件后，重启容器：

```bash
docker compose restart
```

启动时会通过内容指纹判断是否重建数据库（见 `app/server/etl.ts`）。已有的考试记录、练习记录和错题本保存在 `data/app.db`，重建题库不会删除这些用户数据。

### 更新应用代码

```bash
docker compose up -d --build
```

前端资源文件名带内容哈希，`index.html` 使用 `no-cache`，更新后刷新页面即可。

## 数据与备份

- 数据库：`data/app.db`（WAL 模式，运行中还会有 `app.db-wal` / `app.db-shm`）。
- 最稳妥的备份方式：停止容器后复制整个 `data/` 目录。

```bash
docker compose stop
cp -a data data-backup-$(date +%F)
docker compose start
```

- 恢复：停止容器，把备份的 `app.db` 放回 `data/`，再启动。

## 配置

`docker-compose.yml` 里可以改：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8090` | 容器内端口；同时改 `ports` 左侧的宿主机端口 |
| `TZ` | `Asia/Shanghai` | 时区，影响日志时间 |
| `CONTENT_DIR` | `/content` | 题库只读挂载目录 |
| `DATA_DIR` | `/data` | SQLite 数据目录 |
| `STRICT_ETL` | `0` | `1` 时要求题库题数与开发时黄金数字完全一致；换题库时保持 `0` |

端口被占用时，例如改成 18090：

```yaml
ports:
  - "18090:8090"
```

## 家庭成员

右上角头像 → **添加成员**，输入名字、选一个颜色即可。

- 每个成员独立保存：考试记录、进行中的考试、练习记录、错题本；
- 题库、试卷和图片是共享的；
- 切换成员后首页会刷新成该成员的记录，不会串数据；
- 一台新设备第一次打开会先出现「谁在刷题？」选择页；
- **管理成员** 里可以改名或删除成员。删除是软删除：数据仍在 `data/app.db`，只是不再出现在成员列表；至少保留一个成员。

成员隔离是数据分区，不是登录认证，详见下面的安全提醒。

## 安全提醒

**应用没有登录认证**，设计为家庭内网使用。请不要把 8090 端口直接映射到公网。

右上角的「成员切换」是数据分区：每个家庭成员有独立的考试、练习和错题本，但它不是登录认证，知道成员 ID 的人可以在 API 层切换。家庭内网使用足够；如果需要防外人，请加一层真正的认证。

如果确实需要外网访问，至少二选一：

- 在飞牛的反向代理 / 网关上加 Basic Auth；
- 使用 Tailscale、WireGuard 等 VPN 回家。

## 常见问题

**页面空白**

更新后浏览器可能缓存了旧的 `index.html`。强制刷新（Mac：`Cmd+Shift+R`，Windows：`Ctrl+Shift+R`）即可。服务端已对 `index.html` 设置 `no-cache`。

**容器起不来，日志提示 ETL 数字不一致**

说明题库内容与开发时不同。把 `STRICT_ETL` 改成 `"0"`，或确认你是不是换了一整套题库。

**构建 `better-sqlite3` 失败**

Dockerfile 已安装 `python3 make g++`。如果 NAS 无法访问 npm 镜像，可在构建时换源，或先把仓库里的 `app/package-lock.json` 换成官方 registry 生成的版本。

**图片不显示**

确认 `90-图片/` 已挂载到 `/content/90-图片`，并检查 `docker logs` 是否有 ETL 的缺失图片提示。题库本身有 2 张缺失图片，会在页面上显示「图片缺失」占位。

**想清空所有做题记录**

停止容器，删除 `data/app.db`（以及 `-wal`/`-shm`），再启动。会重新建库并丢失考试/练习/错题记录。

## 资源占用

- 题库文本约 101 MB，图片约 365 MB；
- SQLite 约 70 MB；
- 容器内存日常几十 MB，首次 ETL 峰值约 300–500 MB；
- 建议预留 1 GB 磁盘给应用 + 数据（题库另算）。
