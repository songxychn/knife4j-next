# OpenHands GUI Server

本目录包含在服务器上运行 OpenHands GUI 的 Docker Compose 配置。

## 前置条件

- Docker 和 Docker Compose 已安装
- 服务器上已构建 `knife4j-sandbox` 镜像（或可从 registry 拉取）

## 配置

1. 复制环境变量模板：

   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env`，填入真实值：

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   TG_BOT_TOKEN=...
   GH_TOKEN=ghp_...
   ```

   `.env` 已被 `.gitignore` 忽略，不会提交到仓库。

## 拉取镜像

```bash
docker pull docker.openhands.dev/openhands/openhands:1.6
```

## 启动服务

```bash
cd scripts/openhands
docker compose up -d
```

服务启动后访问 `http://<server-ip>:3000`。

## 查看日志

```bash
docker compose logs -f openhands
```

## 重启服务

```bash
docker compose restart openhands
```

## 停止服务

```bash
docker compose down
```

## 注意事项

- 不要将 `.env` 文件提交到版本控制。
- `SANDBOX_BASE_CONTAINER_IMAGE` 已在 `docker-compose.yml` 中固定为 `knife4j-sandbox`，无需在 `.env` 中设置。
- 服务挂载了 `/var/run/docker.sock`，OpenHands 需要此权限来管理沙箱容器。
