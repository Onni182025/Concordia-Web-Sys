# Concordia ERP beta deployment (AlmaLinux 10 Minimal)

This is a legacy guide for deploying the former MySQL-backed application on an AlmaLinux 10 server. The active deployment target is Netlify with Neon PostgreSQL; see [NETLIFY_NEON_DEPLOYMENT.md](./NETLIFY_NEON_DEPLOYMENT.md) instead.

The commands below are retained for reference and do not apply to the PostgreSQL schema.

> **Important for this codebase:** the project currently uses Next.js 13.5.1 and does not include Prisma migration files. Treat this as a limited beta on a trusted network, not a public production launch. Review and update dependencies, test a migration strategy, and have a recoverable database backup before production use.

> **HTTPS is required for sign-in in production mode.** The session cookie is `Secure` when `NODE_ENV=production`; browsers will not send it over plain HTTP. Use HTTPS even on the LAN (a certificate warning is expected for a self-signed beta certificate).

Examples below use:

- Linux deployment user: `concordia`
- Install directory: `/opt/concordia-erp/app`
- Database: `concordia_erp`
- Application port: `3000`
- Example private server IP: `192.168.1.50` — replace this with the server's actual reserved LAN address.

## 1. Prepare AlmaLinux 10 Minimal

Log in as an administrator, update the system, and install basic utilities:

```bash
sudo dnf upgrade --refresh -y
sudo dnf install -y ca-certificates curl git gcc-c++ make openssl nano iproute policycoreutils-python-utils firewalld
sudo reboot
```

After reconnecting, enable firewalld and confirm SSH is allowed before tightening firewall access. Do not close your active admin session until a second SSH session is confirmed.

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --get-active-zones
sudo firewall-cmd --zone=public --list-all
```

Create a dedicated, non-privileged deployment account. Do not run the ERP as `root` and do not add the deployment user to `wheel`.

```bash
sudo useradd --create-home --shell /bin/bash concordia
sudo install -d -o concordia -g concordia /opt/concordia-erp/app
```

Use a separate administrator account with `sudo` for package installation, firewall, and service-management commands. Configure SSH keys and confirm a second administrator SSH session works before disabling password-based SSH. Keep SELinux in enforcing mode:

```bash
getenforce
sudo setenforce 1
```

Persist SELinux enforcing mode in `/etc/selinux/config` by setting `SELINUX=enforcing` if it is not already enabled. Do not solve permission problems by disabling SELinux; inspect AVC denials and correct labels or policy instead.

## 2. Install Node.js and pnpm

Use Node.js 22 LTS for this deployment baseline. The application is on Next.js 13.5.1; verify the app on the selected Node release before beta. Install Node.js from the NodeSource RPM repository:

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo dnf install -y nodejs
rm /tmp/nodesource_setup.sh
node --version
npm --version
```

Install pnpm 9, compatible with the repository's pnpm lockfile version 9:

```bash
sudo npm install --global pnpm@9.15.9
pnpm --version
```

## 3. Install and configure Oracle MySQL

AlmaLinux's default database packages may provide MariaDB rather than Oracle MySQL. This project is configured for MySQL, so install the official Oracle MySQL Community repository package for EL10 (do not substitute MariaDB without testing Prisma compatibility). Confirm the EL10 repository RPM filename at the official MySQL Yum Repository download page before running:

```bash
sudo dnf install -y https://dev.mysql.com/get/mysql84-community-release-el10-1.noarch.rpm
sudo dnf repolist enabled | grep -i mysql
sudo dnf install -y mysql-community-server
sudo systemctl enable --now mysqld
sudo systemctl status mysqld --no-pager
```

If the repository package URL or package name has changed, use the current EL10 repository instructions from Oracle MySQL's official download page. Do not install both MySQL and MariaDB server packages.

Run MySQL's interactive hardening tool:

```bash
sudo mysql_secure_installation
```

Oracle MySQL normally configures a password for its `root` database account. To perform later administrative tasks and database restores without placing passwords in shell history or command arguments, store that password in a root-only client option file:

```bash
sudo install -m 600 /dev/null /root/.my.cnf
sudo nano /root/.my.cnf
```

Add the following, replacing the placeholder with the MySQL root password:

```ini
[client]
user=root
password=REPLACE_WITH_MYSQL_ROOT_PASSWORD
```

Keep this file owned by root with mode `600`. Verify it works with `sudo mysql --defaults-extra-file=/root/.my.cnf`.

Keep MySQL local-only. Check `/etc/my.cnf` and the included files under `/etc/my.cnf.d/`; set `bind-address` in the active server configuration to loopback, not a public/LAN interface:

```ini
bind-address = 127.0.0.1
```

Then restart:

```bash
sudo systemctl restart mysqld
```

Confirm it is only listening locally:

```bash
sudo ss -lntp | grep ':3306'
```

Do not open port 3306 in firewalld or the router.

Create a database and a dedicated application account scoped to that database. Generate a password containing only URL-safe hexadecimal characters:

```bash
openssl rand -hex 32
sudo mysql --defaults-extra-file=/root/.my.cnf
```

At the MySQL prompt (replace `REPLACE_WITH_GENERATED_HEX_PASSWORD`):

```sql
CREATE DATABASE concordia_erp
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'concordia_app'@'127.0.0.1'
  IDENTIFIED BY 'REPLACE_WITH_GENERATED_HEX_PASSWORD';

GRANT ALL PRIVILEGES ON concordia_erp.* TO 'concordia_app'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Prisma needs schema-change privileges for `db push`; this account is scoped to the ERP database, not globally. Do not expose TCP port 3306 in firewalld or your router.

Verify local login, substituting the same password:

```bash
mysql --protocol=TCP -h 127.0.0.1 -u concordia_app -p concordia_erp
```

### Back up and restore the beta database

After the database has been initialized, make a private backup directory and take a dump before schema changes or releases. The Receiving Attachment table stores document bytes in MySQL, so database backups include those documents:

```bash
sudo install -d -m 700 /var/backups/concordia-erp
sudo sh -c 'umask 077; mysqldump --defaults-extra-file=/root/.my.cnf --single-transaction --routines --triggers concordia_erp | gzip > /var/backups/concordia-erp/concordia_erp-$(date +%F-%H%M%S).sql.gz'
```

Verify a dump is non-empty with `sudo ls -lh /var/backups/concordia-erp`. Store an encrypted copy on a separate protected system; a backup on the same physical server does not protect against disk failure.

To restore a chosen backup, first stop the ERP and confirm the target database is the intended beta database:

```bash
sudo systemctl stop concordia-erp
sudo sh -c 'gzip -dc /var/backups/concordia-erp/CHOSEN_BACKUP.sql.gz | mysql --defaults-extra-file=/root/.my.cnf concordia_erp'
sudo systemctl start concordia-erp
```

Restoring overwrites matching database objects/data; test the procedure on a disposable database before relying on it.

### Optional phpMyAdmin

phpMyAdmin is not required. Prefer the MySQL CLI for beta setup. If installed, bind it to localhost or restrict access through an SSH tunnel/VPN; never publish phpMyAdmin on the server IP or forward its port from the router.

## 4. Upload and configure the application

Clone the trusted repository or copy a reviewed release archive. Do not upload `.env`, `node_modules`, `.next`, or database dumps into a public web directory.

```bash
sudo -iu concordia
cd /opt/concordia-erp/app
git clone <PRIVATE_REPOSITORY_URL> .
```

For an uploaded archive, extract the application into this directory and ensure the `concordia` user owns the files.

Install exact lockfile dependencies:

```bash
cd /opt/concordia-erp/app
pnpm install --frozen-lockfile
```

Create a private production environment file:

```bash
umask 077
openssl rand -base64 48
nano .env
chmod 600 .env
```

Set the variables below. Generate `AUTH_SECRET` with `openssl rand -base64 48`, then paste that output into `.env`. Never reuse a development secret or share the value. URL-encode any special characters in the database password; the hexadecimal password above requires no encoding.

```dotenv
NODE_ENV=production
DATABASE_URL="mysql://concordia_app:REPLACE_WITH_GENERATED_HEX_PASSWORD@127.0.0.1:3306/concordia_erp"
AUTH_SECRET="REPLACE_WITH_OUTPUT_FROM_openssl_rand_base64_48"
```

The session implementation requires `AUTH_SECRET` to be at least 32 bytes. The generated 48-byte secret is suitable. Keep `.env` readable only by the deployment account and backups protected.

Generate Prisma Client and initialize the beta database:

```bash
pnpm run db:generate
pnpm run db:push
```

`db:push` syncs the Prisma schema directly and may alter the database. It is appropriate only for initializing a new beta database or after reviewing the planned schema change and taking a backup. This repository currently has no checked-in `prisma/migrations` history; before production, establish and test a Prisma migration workflow. Never use `db push` against valuable production data without a tested backup/restore plan.

For an existing database upgrading to the expanded role list, take and verify a backup first, then run `prisma/migrate-legacy-roles.sql` against the ERP database before `pnpm run db:push`. That script maps `REQUESTER` to `STAFF`, Farm warehouse staff to `FARM_WH_PERSONNEL`, Engineering warehouse staff to `ENGINEERING_WH_PERSONNEL`, and legacy `APPROVER` accounts to `ENGINEERING_SUPERVISOR`. Review this mapping with the company before applying it. `db:push` then creates the `RolePermission` table; default role permissions are initialized when an account signs in. For a fresh database, skip the legacy SQL and apply the Prisma schema directly.

### Initial Super Admin account

Do not use a known/default password or the non-production seed script for production. This repository includes a separate create-only production bootstrap command. It refuses to proceed unless production is explicitly confirmed, requires a strong `AUTH_SECRET`, and refuses if the email or any Super Admin already exists.

First, make sure the database is fresh and no Super Admin has already been provisioned. Then in a private SSH shell, load the protected app environment and prompt for credentials without echoing the password or adding it to shell history:

```bash
cd /opt/concordia-erp/app
set -a
. ./.env
set +a
read -r -p "Super Admin full name: " BOOTSTRAP_SUPER_ADMIN_NAME
read -r -p "Super Admin email: " BOOTSTRAP_SUPER_ADMIN_EMAIL
read -r -s -p "New Super Admin password (16+ characters): " BOOTSTRAP_SUPER_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_SUPER_ADMIN_NAME BOOTSTRAP_SUPER_ADMIN_EMAIL BOOTSTRAP_SUPER_ADMIN_PASSWORD
NODE_ENV=production pnpm run db:bootstrap-admin -- --confirm-production
unset BOOTSTRAP_SUPER_ADMIN_NAME BOOTSTRAP_SUPER_ADMIN_EMAIL BOOTSTRAP_SUPER_ADMIN_PASSWORD
unset DATABASE_URL AUTH_SECRET
```

Use a unique password of at least 16 characters and store it in the organization's password manager. This bootstrap is strictly create-only; for an existing account that cannot sign in, use the approved password-reset process. Do not run `pnpm run db:seed` in production, do not bypass its guard by changing `NODE_ENV`, and do not save bootstrap credentials in `.env`, Git, or shell history. Confirm the new account can sign in over HTTPS before inviting testers.

Build the production application:

```bash
pnpm run build
```

Do not use `pnpm dev` for testers; it is a development server and may expose diagnostics.

## 5. Run the application

### Option A: temporary foreground run

Useful for initial smoke tests from a terminal:

```bash
cd /opt/concordia-erp/app
pnpm start -- --hostname 127.0.0.1 --port 3000
```

Keep the process attached to the terminal. Stop it with `Ctrl+C`. Nginx should be the only network-facing route to the application. Do not bind Next.js to `0.0.0.0` unless there is a specific, temporary reason and the firewall is configured accordingly.

### Option B: systemd service (recommended for beta)

Find the pnpm executable as the `concordia` user:

```bash
command -v pnpm
```

Create `/etc/systemd/system/concordia-erp.service` as root. Replace `/usr/bin/pnpm` below with the path returned by `command -v pnpm`. The Oracle MySQL service is named `mysqld` on this platform:

```ini
[Unit]
Description=Concordia Agribusiness ERP beta
After=network.target mysqld.service
Requires=mysqld.service

[Service]
Type=simple
User=concordia
Group=concordia
WorkingDirectory=/opt/concordia-erp/app
EnvironmentFile=/opt/concordia-erp/app/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm start -- --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now concordia-erp
sudo systemctl status concordia-erp --no-pager
curl -I http://127.0.0.1:3000
```

If `ProtectSystem=full` prevents the app from writing required runtime files, check the service logs first and grant write access only to the required directory; do not make the whole project world-writable.

## 6. Nginx reverse proxy and HTTPS

Install Nginx:

```bash
sudo dnf install -y nginx
sudo systemctl enable --now nginx
```

Allow Nginx to connect to the local Next.js upstream under SELinux:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

### Make a beta TLS certificate

Reserve a static LAN IP (for example `192.168.1.50`) in the router/DHCP server. Generate a self-signed certificate with that IP in its Subject Alternative Name:

```bash
SERVER_IP=192.168.1.50
sudo install -d -m 700 /etc/pki/tls/private/concordia-erp
sudo openssl req -x509 -nodes -days 90 -newkey rsa:3072 \
  -keyout /etc/pki/tls/private/concordia-erp/beta.key \
  -out /etc/pki/tls/certs/concordia-erp-beta.crt \
  -subj "/CN=${SERVER_IP}" \
  -addext "subjectAltName=IP:${SERVER_IP}"
sudo chmod 600 /etc/pki/tls/private/concordia-erp/beta.key
sudo chmod 644 /etc/pki/tls/certs/concordia-erp-beta.crt
sudo restorecon -Rv /etc/pki/tls/private/concordia-erp /etc/pki/tls/certs/concordia-erp-beta.crt
```

Browsers will warn that the self-signed certificate is not trusted. For a smoother beta, use an internal DNS name and a certificate issued by the organization's trusted internal CA, then distribute that CA certificate to tester devices. Keep HTTPS; production-mode session cookies will not work correctly over plain HTTP.

### Configure the proxy

Create `/etc/nginx/conf.d/concordia-erp.conf`:

```nginx
server {
    listen 80;
    server_name 192.168.1.50;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name 192.168.1.50;

    ssl_certificate     /etc/pki/tls/certs/concordia-erp-beta.crt;
    ssl_certificate_key /etc/pki/tls/private/concordia-erp/beta.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Two 5 MiB attachments are sent in one Server Action request.
    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Replace the example IP in both `server_name` directives, then validate and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

If another Nginx configuration already listens on ports 80 or 443, inspect `/etc/nginx/conf.d/` and disable or amend only the conflicting configuration before rechecking.

Test from another device on the same trusted network at:

```text
https://192.168.1.50
```

Accept/trust the beta certificate only after verifying its fingerprint out-of-band. Do not configure router port forwarding for beta testing.

## 7. Firewall and beta security

Use the active firewalld zone reported by `firewall-cmd --get-active-zones` below (shown as `public`) and replace the example subnet with the trusted tester/admin LAN CIDR. Add restricted rules before removing any existing broad SSH allowance, and keep a second administrator session open:

```bash
sudo firewall-cmd --permanent --zone=public --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" service name="ssh" accept'
sudo firewall-cmd --permanent --zone=public --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" service name="http" accept'
sudo firewall-cmd --permanent --zone=public --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" service name="https" accept'
sudo firewall-cmd --reload
sudo firewall-cmd --zone=public --list-all
```

If the zone already has broad `ssh`, `http`, or `https` service entries, remove those broad entries after confirming the restricted rich rules work, for example `sudo firewall-cmd --permanent --zone=public --remove-service=ssh`, then reload and verify from a second session. Do not add rules for ports `3000` or `3306`. Confirm MySQL binds only to loopback and Next.js listens only on `127.0.0.1:3000`.

Keep SELinux enforcing. If Nginx cannot proxy or read its TLS files, inspect recent denials instead of turning SELinux off:

```bash
sudo ausearch -m AVC -ts recent
sudo journalctl -t setroubleshoot --since "15 minutes ago"
```

The `httpd_can_network_connect` boolean above allows the Nginx proxy connection. Use standard certificate locations and `restorecon`; do not grant broad file access or generate policy from unexplained denials.

Additional beta safeguards:

- Use unique, long passwords for the database and all administrator accounts.
- Keep `.env` out of Git, archives shared with testers, web roots, and support tickets.
- Keep the production `AUTH_SECRET` stable across restarts and private to this deployment. Rotating it invalidates sessions.
- Limit access to trusted testers on the LAN or VPN. A LAN deployment is not automatically safe for Internet exposure.
- The application stores uploaded DR and Invoice bytes in MySQL (`ReceivingAttachment`), not in a public upload folder. Back up the database and protect its dumps. The application accepts PDF/PNG/JPG up to 5 MB each.
- Keep AlmaLinux, Node.js, MySQL, Nginx, and dependencies patched. The current Next.js version in `package.json` is old; review dependency security advisories and upgrade/test before any Internet-facing deployment.
- Do not run `pnpm run db:seed` in production. The seed script intentionally rejects `NODE_ENV=production`.
- Set MySQL backups and verify that a restore works before collecting test records that must be retained.

## 8. Operations and useful commands

### systemd service

```bash
sudo systemctl start concordia-erp
sudo systemctl stop concordia-erp
sudo systemctl restart concordia-erp
sudo systemctl status concordia-erp --no-pager
sudo journalctl -u concordia-erp -f
sudo journalctl -u concordia-erp --since "1 hour ago"
```

### Nginx and MySQL

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo journalctl -u nginx -f
sudo systemctl status mysqld --no-pager
sudo journalctl -u mysqld --since "1 hour ago"
```

### Simple foreground run

```bash
cd /opt/concordia-erp/app
pnpm start -- --hostname 127.0.0.1 --port 3000
```

### Optional PM2

Use either PM2 or systemd, not both to supervise the same process:

```bash
sudo npm install --global pm2
sudo -iu concordia
cd /opt/concordia-erp/app
pm2 start pnpm --name concordia-erp -- start -- --hostname 127.0.0.1 --port 3000
pm2 status
pm2 logs concordia-erp
pm2 restart concordia-erp
pm2 stop concordia-erp
pm2 startup
```

Run the command printed by `pm2 startup` with `sudo`, then as `concordia` run:

```bash
pm2 save
```

### Updating the application

Take a database backup before updates. On the server:

```bash
cd /opt/concordia-erp/app
git fetch --all --prune
git checkout <REVIEWED_RELEASE_TAG_OR_COMMIT>
pnpm install --frozen-lockfile
pnpm run db:generate
```

Review schema changes before applying them. For the current beta schema without migration files, only use `pnpm run db:push` after a backup and deliberate review. Then rebuild and restart:

```bash
pnpm run build
sudo systemctl restart concordia-erp
sudo systemctl status concordia-erp --no-pager
curl -kI https://192.168.1.50
```

If the project is copied rather than managed in Git, upload and test a new release directory, then switch to it only after its build and database compatibility are confirmed. Keep the prior release available for rollback; database schema changes may make application-code rollback unsafe.

## 9. Beta tester go-live checklist

- [ ] Server has current AlmaLinux 10 security updates, SELinux enforcing, and a reserved LAN IP.
- [ ] Deployment runs as a non-root account.
- [ ] Node and pnpm versions are recorded; `pnpm install --frozen-lockfile` and `pnpm run build` succeeded on the server.
- [ ] MySQL is enabled, accepts the dedicated application user, is bound to loopback only, and the MySQL root client file is root-only.
- [ ] `DATABASE_URL` uses the dedicated database account; its password is URL-encoded if necessary.
- [ ] `.env` is private, excluded from Git, and contains a unique `AUTH_SECRET` of at least 32 bytes.
- [ ] Prisma Client generation and the reviewed schema setup completed; a database backup and restore test exist.
- [ ] An active Super Admin was provisioned through the approved process; its password has been verified and is not a known/default credential.
- [ ] App starts with `NODE_ENV=production` and is supervised by systemd or PM2.
- [ ] Next.js listens on loopback; Nginx HTTPS works from a separate tester device.
- [ ] Testers understand and trust the beta TLS certificate; login works over HTTPS.
- [ ] firewalld permits only necessary SSH and HTTP/HTTPS access from the trusted LAN/VPN; no router port forwarding exists.
- [ ] MySQL and port 3000 are unreachable from tester devices.
- [ ] Receiving attachment upload, viewing, and download work through Nginx with the 15 MB request limit.
- [ ] Logs are checked for startup/database errors; administrator and tester roles have been checked.
- [ ] Beta data retention, backup schedule, known limitations, and a support contact are communicated.

## Project-specific references

- npm scripts: `package.json` (`build`, `start`, `db:generate`, `db:push`, and `db:seed`).
- Database provider: `prisma/schema.prisma` (`mysql`).
- Required runtime secrets: `DATABASE_URL` and `AUTH_SECRET`; see `.env.example`.
- Database-backed receiving attachments: `ReceivingAttachment` in `prisma/schema.prisma`.
