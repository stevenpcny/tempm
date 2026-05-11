# AI Agent 部署指南

> 本文件专为 AI Agent 阅读。你的任务是引导用户完成 temp-mail 的完整部署。
>
> **核心原则：凡是可以通过 CLI 或 API 完成的步骤，由你直接执行，不要让用户自己做。**
>
> 整个流程中，用户只需要亲自操作 **2 件事**：
> 1. **开启 Namecheap API 访问权限**（一次性，在账号设置里点几下）
> 2. **Vercel 登录**（浏览器授权，点一下）
>
> 域名购买、NS 记录修改、Cloudflare 配置、Worker 部署、前端部署——全部由你自动完成。

---

## 部署流程总览

```
Phase 1  → 收集所有凭据（Namecheap API、Cloudflare API、管理员密码）
Phase 2  → 安装依赖（全自动）
Phase 3  → 通过 Namecheap API 购买域名（全自动）
Phase 4  → 通过 Cloudflare API 添加域名，获取 NS 地址（全自动）
Phase 5  → 通过 Namecheap API 修改 NS 记录（全自动）
Phase 6  → 等待 NS 生效，开启 Email Routing（全自动）
Phase 7  → 创建 D1 数据库 + 部署 Worker + 绑定 Catch-all（全自动，顺序不可调换）
Phase 8  → 部署前端到 Vercel（用户操作①：浏览器登录，其余全自动）
Phase 9  → 更新 CORS 配置并重新部署 Worker（全自动）
Phase 10 → 验证并通过 API 完成管理员面板配置（全自动）
```

---

## Phase 1：收集所有凭据

**一次性收集完，之后不再打断用户。**

### 1.1 询问域名情况

```
你已经有域名了吗？
- 有 → 告诉我域名名称和在哪里注册的，我们跳过购买
- 没有 → 我通过 Namecheap API 帮你自动购买，需要你先开启 API 访问权限
```

**如果用户已有域名（非 Namecheap）：** 将域名存入 `$DOMAIN`，Phase 3 和 Phase 5 改为手动引导用户操作对应注册商界面。

**如果用户已有域名（Namecheap）：** 将域名存入 `$DOMAIN`，跳过 Phase 3，直接进 Phase 4。Phase 5 用 API 自动完成。

**如果用户没有域名 → 执行 1.2。**

### 1.2 引导用户开启 Namecheap API 访问

Namecheap API 默认关闭，需要用户手动开启一次。给出以下指引：

```
我可以通过 Namecheap API 帮你自动购买域名，不需要你手动操作网页。
但需要你先开启 API 访问权限，大约 3 分钟：

① 登录 https://www.namecheap.com（没有账号就先注册，免费）

② 点击右上角用户名 → "Account" → 左侧菜单选 "API Access"
   （直达链接：https://ap.www.namecheap.com/settings/tools/apiaccess/）

③ 点击 "Enable API Access" 旁边的开关，开启它

④ 在 "Whitelisted IPs" 输入框里填入以下 IP 地址，然后点 "Save changes"：
   [此处填入 agent 运行机器的公网 IP，运行 `curl -s https://api.ipify.org` 获取]

⑤ 在同一页面找到 "API Key"，点击 "Generate API Key" 生成（或直接复制已有的 Key）

完成后告诉我：
- Namecheap 用户名：
- Namecheap API Key：（刚才复制的那串）
- 你想要的域名关键词：（比如你的名字或项目名，我来帮你找便宜的）
```

> **注意**：在 1.2 开始前，先运行 `curl -s https://api.ipify.org` 获取当前 IP，填入上面第④步。

### 1.3 收集其余凭据

```
还需要以下信息（请一起提供）：

1. Cloudflare 账号（负责接收邮件，免费）
   没有账号先注册：https://dash.cloudflare.com/sign-up
   有账号后获取 API Key：
   → 打开 https://dash.cloudflare.com/profile/api-tokens
   → 页面底部 "Global API Key" → 点 View → 输入密码 → 复制
   请告诉我：Global API Key 和 Cloudflare 账号邮箱

2. 管理员密码（登录本系统管理后台用）
   输入"自动生成"或告诉我你想用的密码
```

收到后：
- 自动生成密码时，生成 16 位强密码（大小写+数字+符号），**醒目展示给用户，要求保存好**。
- 存入变量：`$NC_USER`、`$NC_API_KEY`、`$CF_API_KEY`、`$CF_EMAIL`、`$ADMIN_PASSWORD`

---

## Phase 2：安装依赖（全自动）

```bash
# 获取本机公网 IP（用于后续 Namecheap API 调用）
export MY_IP=$(curl -s https://api.ipify.org)
echo "本机 IP：$MY_IP"

# 前端依赖
npm install

# Worker 依赖
cd worker && npm install && cd ..

# 检查 wrangler
npx wrangler --version || npm install -g wrangler
```

---

## Phase 3：通过 Namecheap API 购买域名（全自动）

如果用户已有域名，跳过本节。

### 3.1 搜索可用域名

根据用户提供的关键词，查找价格便宜且可注册的域名：

```bash
# 检查多个后缀的可用性（以关键词 "mymail" 为例，替换为实际关键词）
for tld in top site online store; do
  curl -s "https://api.namecheap.com/xml.response\
?ApiUser=$NC_USER&ApiKey=$NC_API_KEY&UserName=$NC_USER\
&Command=namecheap.domains.check&ClientIp=$MY_IP\
&DomainList=mymail.$tld" | grep -o 'Domain="[^"]*" Available="[^"]*"'
done
```

从结果中选一个 `Available="true"` 的域名，优先选 `.top`（最便宜）。存入 `$DOMAIN`。

### 3.2 购买域名

Namecheap `domains.create` 需要注册人联系信息。询问用户：

```
购买域名需要填写注册人信息（可使用假名，开启 WHOIS 隐私保护后不会公开）：
- 名字（First Name）：
- 姓氏（Last Name）：
- 邮箱：
- 电话（格式 +1.4155551234）：
- 国家（两位代码，如 US）：
- 省/州：
- 城市：
- 地址：
- 邮编：

确保你的 Namecheap 账号已绑定付款方式（信用卡或 Namecheap 账户余额）。
准备好后告诉我，我来自动完成购买。
```

收到信息后执行购买：

```bash
curl -s "https://api.namecheap.com/xml.response" \
  --data-urlencode "ApiUser=$NC_USER" \
  --data-urlencode "ApiKey=$NC_API_KEY" \
  --data-urlencode "UserName=$NC_USER" \
  --data-urlencode "Command=namecheap.domains.create" \
  --data-urlencode "ClientIp=$MY_IP" \
  --data-urlencode "DomainName=$DOMAIN" \
  --data-urlencode "Years=1" \
  --data-urlencode "AddFreeWhoisguard=yes" \
  --data-urlencode "WGEnabled=yes" \
  --data-urlencode "RegistrantFirstName=$REG_FIRSTNAME" \
  --data-urlencode "RegistrantLastName=$REG_LASTNAME" \
  --data-urlencode "RegistrantAddress1=$REG_ADDRESS" \
  --data-urlencode "RegistrantCity=$REG_CITY" \
  --data-urlencode "RegistrantStateProvince=$REG_STATE" \
  --data-urlencode "RegistrantPostalCode=$REG_ZIP" \
  --data-urlencode "RegistrantCountry=$REG_COUNTRY" \
  --data-urlencode "RegistrantPhone=$REG_PHONE" \
  --data-urlencode "RegistrantEmailAddress=$REG_EMAIL" \
  --data-urlencode "TechFirstName=$REG_FIRSTNAME" \
  --data-urlencode "TechLastName=$REG_LASTNAME" \
  --data-urlencode "TechAddress1=$REG_ADDRESS" \
  --data-urlencode "TechCity=$REG_CITY" \
  --data-urlencode "TechStateProvince=$REG_STATE" \
  --data-urlencode "TechPostalCode=$REG_ZIP" \
  --data-urlencode "TechCountry=$REG_COUNTRY" \
  --data-urlencode "TechPhone=$REG_PHONE" \
  --data-urlencode "TechEmailAddress=$REG_EMAIL" \
  --data-urlencode "AdminFirstName=$REG_FIRSTNAME" \
  --data-urlencode "AdminLastName=$REG_LASTNAME" \
  --data-urlencode "AdminAddress1=$REG_ADDRESS" \
  --data-urlencode "AdminCity=$REG_CITY" \
  --data-urlencode "AdminStateProvince=$REG_STATE" \
  --data-urlencode "AdminPostalCode=$REG_ZIP" \
  --data-urlencode "AdminCountry=$REG_COUNTRY" \
  --data-urlencode "AdminPhone=$REG_PHONE" \
  --data-urlencode "AdminEmailAddress=$REG_EMAIL" \
  --data-urlencode "AuxBillingFirstName=$REG_FIRSTNAME" \
  --data-urlencode "AuxBillingLastName=$REG_LASTNAME" \
  --data-urlencode "AuxBillingAddress1=$REG_ADDRESS" \
  --data-urlencode "AuxBillingCity=$REG_CITY" \
  --data-urlencode "AuxBillingStateProvince=$REG_STATE" \
  --data-urlencode "AuxBillingPostalCode=$REG_ZIP" \
  --data-urlencode "AuxBillingCountry=$REG_COUNTRY" \
  --data-urlencode "AuxBillingPhone=$REG_PHONE" \
  --data-urlencode "AuxBillingEmailAddress=$REG_EMAIL"
```

检查响应中 `Status="OK"` 且无 `<Error>` 节点。购买成功后告知用户。

---

## Phase 4：通过 Cloudflare API 添加域名（全自动）

### 4.1 获取 Cloudflare Account ID

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY"
```

取第一个账户的 `id`，存入 `$CF_ACCOUNT_ID`。若有多个账户，按账号名与用户提供的邮箱匹配。

### 4.2 检查域名是否已在 Cloudflare

```bash
curl -s "https://api.cloudflare.com/client/v4/zones?name=$DOMAIN" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY"
```

- `result` 非空 → 取 `result[0].id` 存入 `$ZONE_ID`，跳到 4.4
- `result` 为空 → 执行 4.3

### 4.3 将域名添加到 Cloudflare

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$DOMAIN\",\"account\":{\"id\":\"$CF_ACCOUNT_ID\"},\"type\":\"full\"}"
```

从响应提取：
- `result.id` → `$ZONE_ID`
- `result.name_servers[0]` → `$NS1`
- `result.name_servers[1]` → `$NS2`

### 4.4 确认 NS 地址

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY"
```

从 `name_servers` 确认 `$NS1`、`$NS2`。

---

## Phase 5：通过 Namecheap API 修改 NS 记录（全自动）

有了 Namecheap API，NS 修改不需要用户手动操作。

将域名拆成 SLD 和 TLD（如 `mymail.top` → SLD=`mymail`，TLD=`top`）：

```bash
DOMAIN_SLD=$(echo $DOMAIN | cut -d. -f1)
DOMAIN_TLD=$(echo $DOMAIN | cut -d. -f2-)
```

调用 Namecheap API 设置自定义 NS：

```bash
curl -s "https://api.namecheap.com/xml.response" \
  --data-urlencode "ApiUser=$NC_USER" \
  --data-urlencode "ApiKey=$NC_API_KEY" \
  --data-urlencode "UserName=$NC_USER" \
  --data-urlencode "Command=namecheap.domains.dns.setCustom" \
  --data-urlencode "ClientIp=$MY_IP" \
  --data-urlencode "SLD=$DOMAIN_SLD" \
  --data-urlencode "TLD=$DOMAIN_TLD" \
  --data-urlencode "Nameservers=$NS1,$NS2"
```

检查响应中 `<DomainDNSSetCustomResult Domain="$DOMAIN" Update="true"/>` 表示成功。

告知用户：`✅ NS 记录已自动更新，等待全球 DNS 生效（通常 10 分钟到 2 小时）。`

**如果用户的域名不在 Namecheap：** 此步骤改为手动引导，给出对应注册商的操作步骤（见附录）。

---

## Phase 6：等待 NS 生效，开启 Email Routing（全自动）

NS 更新命令已发出，立即开始轮询，不要让用户等待。

### 6.1 轮询 NS 生效

每隔 60 秒执行：

```bash
dig NS $DOMAIN +short
```

输出包含 `cloudflare.com` → 切换成功，继续。

同步确认 Cloudflare zone 状态：

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  | grep -o '"status":"[^"]*"'
```

`status` 为 `active` 时继续。`dig` 不可用时 fallback：

```bash
nslookup -type=NS $DOMAIN 8.8.8.8
```

> NS 生效通常 10 分钟到 2 小时。期间告诉用户去做别的事，生效后通知他继续。

### 6.2 开启 Email Routing

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/enable" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{}'
```

Cloudflare 自动添加 MX 和 SPF 记录。

---

## Phase 7：创建 D1 数据库并部署 Worker（全自动）

设置 wrangler 环境变量，跳过浏览器登录：

```bash
export CLOUDFLARE_API_KEY="$CF_API_KEY"
export CLOUDFLARE_EMAIL="$CF_EMAIL"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
```

### 7.1 创建 D1 数据库

```bash
cd worker && npx wrangler d1 create temp-mail-db && cd ..
```

解析输出中 `database_id`（UUID 格式），存入 `$DATABASE_ID`。

如果报"已存在"：

```bash
cd worker && npx wrangler d1 list && cd ..
```

找 `temp-mail-db` 对应 ID。

### 7.2 写入 Worker 配置

修改 `worker/wrangler.toml`：

```toml
name = "temp-mail-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true
account_id = "$CF_ACCOUNT_ID"

[[d1_databases]]
binding = "DB"
database_name = "temp-mail-db"
database_id = "$DATABASE_ID"

[triggers]
crons = ["0 3 * * *"]

[vars]
ALLOWED_ORIGINS = "http://localhost:3000"
ADMIN_PASSWORD = "$ADMIN_PASSWORD"
```

### 7.3 初始化数据库表结构

```bash
cd worker && npm run db:init && cd ..
```

### 7.4 部署 Worker

```bash
cd worker && npm run deploy && cd ..
```

解析输出中的 Worker URL，存入 `$WORKER_URL`。

### 7.5 绑定 Email Routing Catch-all（必须在 7.4 之后执行）

Worker 已存在后才能绑定，否则 Cloudflare 报错：

```bash
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/rules/catch_all" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Catch-all to temp-mail-worker",
    "enabled": true,
    "matchers": [{"type": "all"}],
    "actions": [{"type": "worker", "value": ["temp-mail-worker"]}]
  }'
```

确认响应 `success: true`。

---

## Phase 8：部署前端到 Vercel

### 8.1 更新本地环境变量文件

```bash
echo "NEXT_PUBLIC_WORKER_URL=$WORKER_URL" > .env.local
```

### 8.2 登录 Vercel（唯一需要用户操作浏览器的步骤）

```bash
npm install -g vercel
vercel login
```

告知用户：

```
🌐 浏览器会打开 Vercel 登录页，推荐用 GitHub 账号登录（点 "Continue with GitHub"）。
授权完成后回来告诉我，我自动继续。
```

### 8.3 首次初始化项目

```bash
vercel --yes
```

按提示回答：
- `Set up and deploy?` → Y
- `Which scope?` → 个人账号
- `Link to existing project?` → N
- `Project name?` → temp-mail（或任意名称）
- `Directory?` → ./（回车）

### 8.4 写入构建期环境变量

`NEXT_PUBLIC_WORKER_URL` 是 Next.js 构建期变量，必须在 build 前写入，不能用 `-e` 运行时传入：

```bash
vercel env add NEXT_PUBLIC_WORKER_URL production <<< "$WORKER_URL"
vercel env add NEXT_PUBLIC_WORKER_URL preview <<< "$WORKER_URL"
```

### 8.5 发布到生产

```bash
vercel --prod --yes
```

解析生产 URL，存入 `$VERCEL_URL`。

---

## Phase 9：更新 CORS 并重新部署 Worker（全自动）

```bash
# 更新 wrangler.toml 中的 ALLOWED_ORIGINS
sed -i '' "s|ALLOWED_ORIGINS = \".*\"|ALLOWED_ORIGINS = \"$VERCEL_URL,http://localhost:3000\"|" worker/wrangler.toml

# 重新部署
cd worker && npm run deploy && cd ..
```

---

## Phase 10：自动验证并完成配置（全自动）

### 10.1 验证所有组件正常

```bash
# Worker API
curl -s "$WORKER_URL/api/config" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ Worker OK, domains:', d.get('domains'))"

# CORS
curl -s -H "Origin: $VERCEL_URL" -I "$WORKER_URL/api/config" | grep "Access-Control-Allow-Origin"

# Email Routing MX
dig MX $DOMAIN +short | grep cloudflare
```

### 10.2 通过 Worker API 自动添加域名配置

无需用户手动进管理面板，直接调用 admin API：

```bash
curl -s -X POST "$WORKER_URL/api/admin/config" \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  --data "{\"domains\":[\"$DOMAIN\"]}"
```

确认响应 `{"ok":true}`。

### 10.3 告知用户部署完成

```
🎉 所有配置已全部自动完成！

你的临时邮箱系统已上线：$VERCEL_URL
管理后台：$VERCEL_URL/admin
管理员密码：$ADMIN_PASSWORD（请保存好）

现在可以测试：
1. 打开 $VERCEL_URL
2. 点"随机生成"得到一个临时邮箱地址
3. 用这个地址去任意网站注册，等邮件出现

收到邮件 ✅ = 大功告成
没收到 = 告诉我，我来排查
```

---

## 故障排查

```bash
# 1. Worker API 是否正常
curl -s "$WORKER_URL/api/config"

# 2. MX 记录是否生效
dig MX $DOMAIN +short

# 3. Catch-all 规则是否存在
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/rules/catch_all" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY"

# 4. CORS 是否正确
curl -s -H "Origin: $VERCEL_URL" -I "$WORKER_URL/api/config" | grep "Access-Control"

# 5. 域名是否在 Worker 配置中
curl -s "$WORKER_URL/api/config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('domains'))"
```

**Email Routing 报 `zone not active`**：NS 未生效，继续等待轮询。

**Worker 部署失败**：检查 `worker/wrangler.toml` 中 `account_id` 和 `database_id` 是否正确。

**Namecheap API 报 `2030166` 错误**：IP 未在白名单，重新确认 Phase 1.2 第④步的 IP 是否与当前 `$MY_IP` 一致。

---

## 附录：其他注册商手动修改 NS

如果用户域名不在 Namecheap，Phase 5 改为手动指引：

- **Porkbun**：登录 → 点域名 Details → Nameservers → Edit → 填入 $NS1 和 $NS2
- **GoDaddy**：My Products → 域名旁 DNS → Nameservers → Change → Enter my own → 填入 $NS1 和 $NS2
- **Dynadot**：My Domains → 点域名 → DNS Settings → Name Servers → Custom → 填入 $NS1 和 $NS2

---

## 变量速查

| 变量 | 来源 | 用于 |
|------|------|------|
| `$NC_USER` | Phase 1 用户提供 | Namecheap API |
| `$NC_API_KEY` | Phase 1 用户提供 | Namecheap API |
| `$MY_IP` | Phase 2 自动获取 | Namecheap API ClientIp |
| `$DOMAIN` | Phase 1/3 确认 | 所有域名相关操作 |
| `$CF_API_KEY` | Phase 1 用户提供 | 所有 Cloudflare API |
| `$CF_EMAIL` | Phase 1 用户提供 | 所有 Cloudflare API |
| `$ADMIN_PASSWORD` | Phase 1 生成/提供 | Worker 配置、管理后台 |
| `$CF_ACCOUNT_ID` | Phase 4.1 查询 | zone 创建、wrangler |
| `$ZONE_ID` | Phase 4.2/4.3 | Email Routing API |
| `$NS1` / `$NS2` | Phase 4.3/4.4 | Namecheap DNS 修改 |
| `$DATABASE_ID` | Phase 7.1 | wrangler.toml |
| `$WORKER_URL` | Phase 7.4 | .env.local、CORS |
| `$VERCEL_URL` | Phase 8.5 | CORS、告知用户 |
