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

> **⚠️ Namecheap API 不可用时的回退路径**
>
> 部分账号（通常是新账号或消费未满 $50 的账号）无法开启 API Access——页面上的开关是灰色的或操作后报错。
> 遇到此情况，**不要继续尝试 API**，切换为手动流程：
>
> 1. 引导用户在 Namecheap 网页手动购买域名（Phase 3 跳过，改为提示用户完成购买后告知域名）。
> 2. Phase 5（NS 修改）同样改为手动：
>    - 登录 Namecheap → Domain List → 点域名旁 "Manage" → "Nameservers" 选 "Custom DNS"
>    - 填入 `$NS1` 和 `$NS2`，保存
>    - 提示用户完成后告知你，继续 Phase 6
> 3. 跳过所有 `$NC_USER` / `$NC_API_KEY` 变量的收集，本次部署不需要它们。

### 1.3 收集其余凭据

```
还需要以下信息（请一起提供）：

1. Cloudflare 账号（负责接收邮件，免费）
   没有账号先注册：https://dash.cloudflare.com/sign-up
   有账号后获取 API Key：
   → 打开 https://dash.cloudflare.com/profile/api-tokens
   → 页面底部 "Global API Key" → 点 View → 输入密码 → 复制
   请告诉我：Global API Key 和 Cloudflare 账号邮箱
   （推荐使用 Global API Key，权限最全，无需额外配置）

2. 管理员密码（登录本系统管理后台用）
   输入"自动生成"或告诉我你想用的密码
```

收到后：
- 自动生成密码时，生成 16 位强密码（大小写+数字+符号），**醒目展示给用户，要求保存好**。
- 存入变量：`$NC_USER`、`$NC_API_KEY`、`$CF_API_KEY`、`$CF_EMAIL`、`$ADMIN_PASSWORD`

> **⚠️ 使用 API Token 而非 Global API Key 时**
>
> 若用户提供的是 Cloudflare API Token（细粒度 token），需确认 token 具备以下所有权限，缺少任一会在对应步骤报 permission denied：
>
> | 权限范围 | 所需权限 |
> |---------|---------|
> | Account | Workers Scripts: Edit |
> | Account | D1: Edit |
> | Account | Zone: Create（用于添加新域名） |
> | Zone | DNS: Edit |
> | Zone | Email Routing: Edit |
> | Zone | Worker Routes: Edit |
>
> **强烈推荐首次部署使用 Global API Key**，以避免权限缺失导致的中途失败。

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

> **首次使用 Cloudflare Workers 的账号**：第一次部署 Worker 前，Cloudflare 要求注册一个 `workers.dev` 子域名。
> 如果 `npm run deploy` 报错提示 "subdomain not registered"，通过 Cloudflare API 注册（`wrangler subdomain` 命令已在新版 wrangler 中废弃，不要使用）：
>
> ```bash
> # 将 YOUR_SUBDOMAIN 替换为你想用的子域名（全局唯一，建议用用户名或项目名）
> curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/subdomain" \
>   -H "X-Auth-Email: $CF_EMAIL" \
>   -H "X-Auth-Key: $CF_API_KEY" \
>   -H "Content-Type: application/json" \
>   --data '{"subdomain":"YOUR_SUBDOMAIN"}'
> ```
>
> 确认响应 `"success":true` 后重新执行部署命令。这是一次性操作，后续部署无需重复。

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

### 6.3 Email Routing 就绪检查清单（按顺序确认，全部通过再进入 Phase 7）

- [ ] **Cloudflare zone 状态为 active**（6.1 已确认）
- [ ] **Email Routing 已启用**（6.2 API 返回 `success: true`）
- [ ] **Worker 已部署**（Phase 7.4 完成后回来确认）
- [ ] **Catch-all 规则已绑定到 Worker**（Phase 7.5 完成后回来确认）
- [ ] **MX 记录已生效**：`dig MX $DOMAIN +short` 包含 `cloudflare.com`

> Catch-all 规则和 MX 记录检查需等 Phase 7 完成后才能验证，Phase 7 结束后务必回来补充确认。

---

## Phase 7：创建 D1 数据库并部署 Worker（全自动）

设置 wrangler 环境变量，跳过浏览器登录：

```bash
export CLOUDFLARE_API_KEY="$CF_API_KEY"
export CLOUDFLARE_EMAIL="$CF_EMAIL"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
```

> **说明**：`CLOUDFLARE_ACCOUNT_ID` 环境变量优先级高于 `worker/wrangler.toml` 中的 `account_id` 字段。即使 toml 中仍为占位符 `YOUR_CLOUDFLARE_ACCOUNT_ID`，wrangler 也会使用环境变量中的真实值，不影响命令执行。`account_id` 字段会在 7.2 步骤中一并写入正确值。

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
# ADMIN_PASSWORD 通过 wrangler secret 注入，不写入此文件
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

### 7.4.1 注入 ADMIN_PASSWORD Secret

Worker 部署后立即写入管理员密码（不可在 `wrangler.toml` 明文存放）：

```bash
echo "$ADMIN_PASSWORD" | cd worker && npx wrangler secret put ADMIN_PASSWORD && cd ..
```

确认命令输出 `✔ Success! Uploaded secret ADMIN_PASSWORD`。

### 7.4.2（可选）为 Worker 绑定自定义 API 域名

如果不想使用默认的 `workers.dev` URL，可以将 Worker 绑定到自己域名下的子域名（如 `api.yourdomain.com`），使前端 API 地址更干净稳定。

在 `worker/wrangler.toml` 末尾添加：

```toml
[[routes]]
pattern = "api.yourdomain.com"
custom_domain = true
```

然后重新部署：

```bash
cd worker && npm run deploy && cd ..
```

完成后将 `$WORKER_URL` 更新为 `https://api.yourdomain.com`，并在后续 Phase 8 和 Phase 9 中使用这个地址替代 workers.dev 地址。

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
vercel whoami 2>/dev/null && echo "已登录，跳过 vercel login" || vercel login
```

> `vercel whoami` 若已有有效 token 会输出当前账号名；若未登录则自动执行 `vercel login`，避免重复弹出浏览器授权窗口。
>
> **若环境无法打开浏览器**（如纯 CLI/SSH 环境，`vercel login` 卡住或报错）：改用 `vercel login --github` 走 GitHub OAuth，或在浏览器机器上登录后从 `~/.vercel/auth.json` / Vercel Dashboard → Settings → Tokens 取 token，再用 `vercel --token $VERCEL_TOKEN ...` 跑后续所有命令。注意：token 即使认证成功也可能没有任何可用 scope，此时仍会报 `missing_scope`，按 8.3 的 `--scope` 处理。

告知用户：

```
🌐 浏览器会打开 Vercel 登录页，推荐用 GitHub 账号登录（点 "Continue with GitHub"）。
授权完成后回来告诉我，我自动继续。
```

### 8.3 首次初始化项目

> **⚠️ 必须显式传 `--name`，否则会出现双 https URL 无法访问**
>
> Vercel 默认从当前**目录名**派生项目名和访问 URL。若仓库目录名包含 `https`、`github-com` 等词（例如从 GitHub 链接克隆后未重命名的目录），生成的域名会变成：
>
> ```
> https://https-github-com-yourname-tempm-xxxx.vercel.app
> ```
>
> URL 里出现两个 `https`，浏览器无法解析，前端完全无法打开。**务必手动指定一个干净的项目名。**

```bash
# 查看当前登录的账号名（用于后续 --scope）
vercel whoami

# 使用干净的项目名部署，避免从目录名自动派生
vercel --yes --name temp-mail
```

如果报错 `missing_scope: Provide --scope or --team explicitly`：

```bash
# 查询可用 scope 列表
vercel teams ls 2>/dev/null; vercel whoami

# 指定 scope 重新部署（替换 YOUR_USERNAME 为 whoami 输出的账号名）
vercel --yes --name temp-mail --scope YOUR_USERNAME
```

按提示回答：
- `Link to existing project?` → N
- `Directory?` → ./（回车）

### 8.4 写入构建期环境变量

`NEXT_PUBLIC_WORKER_URL` 是 Next.js 构建期变量，必须在 build 前写入，不能用 `-e` 运行时传入：

```bash
vercel env add NEXT_PUBLIC_WORKER_URL production <<< "$WORKER_URL"
vercel env add NEXT_PUBLIC_WORKER_URL preview <<< "$WORKER_URL"
```

### 8.5 发布到生产

```bash
vercel --prod --yes --name temp-mail
```

> **注意**：Vercel 可能在部署过程中提示需要连接 GitHub 账号。这是**非阻塞警告**，CLI 上传部署不依赖 GitHub 连接，直接忽略即可，部署会正常完成。只有当你需要 Git push 触发自动部署时才需要连接 GitHub。

解析生产 URL，存入 `$VERCEL_URL`。

> **验证 URL 格式**：确认 `$VERCEL_URL` 以 `https://` 开头且不包含第二个 `https`（即不是 `https://https-...`）。若 URL 异常，说明项目名未正确指定，在 Vercel Dashboard 将项目重命名为 `temp-mail` 后重新执行 `vercel --prod --yes --name temp-mail`。

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
# 安全检查：admin API 必须通过 HTTPS 调用，防止 bearer token 泄露
if [[ "$WORKER_URL" != https://* ]]; then
  echo "❌ WORKER_URL 必须以 https:// 开头才能安全发送 ADMIN_PASSWORD，请检查 Phase 7.4 的输出"
  exit 1
fi

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

### 10.4 收尾报告（给后续 AI agent / 用户存档）

部署完成后，输出一份关键信息汇总，避免后续接手者重新逆向推断：

```
部署信息汇总：
- 域名：$DOMAIN
- Worker URL：$WORKER_URL
- 前端 URL：$VERCEL_URL
- Cloudflare zone：$ZONE_ID
- D1 database：$DATABASE_ID
- 部署中遇到并解决的问题：（逐条列出，例如 catch-all code 2020、Vercel scope 等）
```

若用户反馈“没收到邮件”，按「故障排查」逐项核对后再改动配置，**不要凭猜测改代码**。

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

**Vercel 域名带双重 https**（如 `https://https-github-com-....vercel.app`）：部署时未传 `--name`，目录名被当成项目名。在 Vercel Dashboard 将项目重命名为 `temp-mail`，然后重新执行 `vercel --prod --yes --name temp-mail`。

**Catch-all 绑定报 `code 2020 / Invalid rule operation`**：这不是 NS/MX 传播问题，**不要让用户等待或手动操作**。根因是 Phase 7.5 在 Worker 尚未部署时就调用了绑定 API，或 Worker 名称与 `actions.value` 不一致。确认 `cd worker && npm run deploy` 已成功、`temp-mail-worker` 这个名字与 `worker/wrangler.toml` 的 `name` 字段一致，然后重新执行 7.5 的 PUT 请求即可。

---

## 追加收信域名（首次部署完成之后）

本指南覆盖的是**首个域名**的全新部署。若系统已上线、只是想再挂一个收信域名，**不要重跑整个流程**——重点是只做增量步骤：

1. 新域名同样要走 Phase 4（建 zone）、Phase 5（改 NS）、Phase 6（等 NS 生效）、Phase 7.5（绑定 catch-all 到**同一个** `temp-mail-worker`，Worker 无需重新部署）。
2. **不需要**重建 D1、不需要重新部署前端、不需要新建 Vercel 项目。
3. 通过 admin API 把新域名追加进配置（注意要带上已有域名，POST 是整体覆盖）：
   ```bash
   curl -s -X POST "$WORKER_URL/api/admin/config" \
     -H "Authorization: Bearer $ADMIN_PASSWORD" \
     -H "Content-Type: application/json" \
     --data "{\"domains\":[\"existing.com\",\"$NEW_DOMAIN\"]}"
   ```
4. CORS 不受影响（域名变的是收信端，不是前端）。

> 项目内已有 `add-email-domain` 技能封装了上述增量流程，用户说“加域名”时应优先调用该技能，而不是手工照搬本指南。

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
