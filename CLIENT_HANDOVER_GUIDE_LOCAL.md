# Clone2GHL — Client Handover Guide (Local-Only Deployment)
**Complete Setup for Self-Hosted Backend + Local Extension Loading**

**Version:** 1.0 (Local Edition)  
**Date:** May 24, 2026  
**Purpose:** Comprehensive guide for local-only deployment and handover

---

## 📋 Table of Contents

1. [What You're Receiving](#what-youre-receiving)
2. [Pre-Handover Checklist](#pre-handover-checklist)
3. [Backend Setup](#backend-setup)
4. [Extension Setup](#extension-setup)
5. [User Distribution](#user-distribution)
6. [Post-Launch Support](#post-launch-support)
7. [Maintenance & Updates](#maintenance--updates)
8. [Troubleshooting](#troubleshooting)
9. [Appendices](#appendices)

---

## What You're Receiving

### 📦 Complete Package Includes:

1. **Chrome Extension** (`extension/` folder)
   - Full source code and assets
   - Manifest.json with all permissions
   - UI components (popup, dashboard)
   - Integration modules (GHL, OpenAI, HeyGen)
   - Ready for dev mode loading (not Web Store)

2. **Backend Server** (`backend/` folder)
   - Authentication system (JWT)
   - Usage metering and plan management
   - Video generation integration (HeyGen)
   - Stripe billing foundation
   - API routes for all extension features
   - Pre-configured for local deployment

3. **Documentation**
   - Installation guide (INSTALL.md) - local focus
   - User guide (USER_GUIDE.md) - how to use features
   - This handover guide - local deployment focus
   - Privacy policy (PRIVACY_POLICY.md)
   - Terms of service (terms-and-conditions.html)

4. **Assets & Configuration**
   - Funnel library (15+ pre-built templates)
   - Icon generation tool
   - Backend .env.example (all variables documented)
   - Database setup scripts

---

## Pre-Handover Checklist

### ✅ Technical Verification (Developer Does This)

**Extension Readiness:**
- [ ] Icons generated and placed in `extension/icons/`
  - `icon16.png` (16x16), `icon48.png` (48x48), `icon128.png` (128x128)
- [ ] No hardcoded API keys in any source files
- [ ] manifest.json configured correctly
- [ ] No console errors when loaded in dev mode
- [ ] All permissions documented in PERMISSIONS_JUSTIFICATION.md

**Backend Readiness:**
- [ ] Node.js v16+ compatibility verified
- [ ] All .env variables documented in .env.example
- [ ] Database migrations ready (if using DB)
- [ ] Authentication flow tested (register, login, token refresh)
- [ ] API endpoints functional without extension

**Documentation:**
- [ ] INSTALL.md updated for local setup (not Web Store)
- [ ] USER_GUIDE.md complete with feature documentation
- [ ] Privacy policy includes all required sections
- [ ] Troubleshooting guide covers common local setup issues

### ✅ Credentials & Access Transfer

**Client Must Have Before Handover:**
- [ ] GoHighLevel API key (from Private Integrations)
- [ ] GoHighLevel Location ID
- [ ] OpenAI API key (with billing enabled)
- [ ] HeyGen API key (optional, if using video generation)
- [ ] Stripe API keys (optional, if using billing)
- [ ] GitHub repository access (for source code)
- [ ] Web hosting account (AWS, DigitalOcean, Heroku, etc.)
- [ ] Domain name with DNS access (for backend API)
- [ ] SSL certificate (Let's Encrypt recommended, free)

### ✅ Legal & Compliance

- [ ] Privacy Policy reviewed and customized
- [ ] Terms of Service updated with company name
- [ ] Branding elements (logos, colors) identified
- [ ] Data protection policies in place (GDPR, CCPA if applicable)

---

## Backend Setup

### Overview

Your **self-hosted backend** provides:
- User authentication & registration
- API key management
- Usage tracking & plan limits
- Stripe billing integration
- Video generation support
- Direct control over user data

**Timeline:** 1-2 days setup  
**Cost:** ~$10-50/month hosting

### Step 1: Choose & Provision Hosting

**Options:**

| Provider | Cost | Ease | Recommended For |
|----------|------|------|-----------------|
| **DigitalOcean** | $5-20/mo | Easy | Small to medium users |
| **AWS EC2** | $10-50/mo | Medium | Scalability required |
| **Heroku** | $7-50/mo | Very easy | Quick MVP launch |
| **Azure** | $10-50/mo | Medium | Enterprise integration |
| **Self-managed** | Variable | Hard | On-premise requirement |

**Minimum Requirements:**
- OS: Linux (Ubuntu 20.04+) or Windows Server
- Node.js: v16 or higher
- RAM: 2GB minimum (4GB recommended)
- Storage: 20GB minimum
- CPU: 1-2 cores minimum
- SSL certificate (Let's Encrypt free)
- Accessible via domain name

**Quick Start (DigitalOcean):**
1. Create account at digitalocean.com
2. Create new Droplet:
   - Image: Ubuntu 20.04 LTS
   - Size: $5/month (2GB RAM)
   - Region: Choose closest to users
   - Enable backups
3. Get IP address and SSH access
4. Point domain to IP in DNS settings

### Step 2: Install Prerequisites

**On your server, run:**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js v18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install npm (comes with Node.js)
npm --version   # Verify installation

# Install Git
sudo apt install -y git

# Optional: Install PM2 for process management
sudo npm install -g pm2

# Verify Node.js
node --version
```

### Step 3: Clone Repository & Configure

```bash
# Clone your backend repository
git clone [your-repo-url] /opt/clone2ghl-backend
cd /opt/clone2ghl-backend

# Copy environment template
cp .env.example .env

# Edit with your configuration
nano .env
```

**Configure .env file:**

```bash
# Server Configuration
PORT=8080
NODE_ENV=production
LOG_LEVEL=info

# Security
JWT_SECRET=[generate-strong-random-string]
CORS_ORIGIN=https://yourdomain.com

# Database (choose one)
# MongoDB:
MONGODB_URI=mongodb://username:password@host:port/clone2ghl

# PostgreSQL:
# POSTGRESQL_URL=postgresql://user:password@host:5432/clone2ghl

# Third-party APIs (client's keys)
OPENAI_API_KEY=[client-provides]
HEYGEN_API_KEY=[client-provides-optional]

# Stripe (if using billing)
STRIPE_SECRET_KEY=[client-provides]
STRIPE_PUBLISHABLE_KEY=[client-provides]
STRIPE_WEBHOOK_SECRET=[client-provides]

# Email (optional, for notifications)
SMTP_HOST=smtp.yourmail.com
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@yourdomain.com
```

**To generate JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Install Dependencies & Setup Database

```bash
# Install npm packages
npm install

# Run database migrations (if using database)
npm run migrate

# Create initial admin user (if applicable)
npm run seed
```

### Step 5: Start Backend Service

**Option A: Development Mode**
```bash
# Run in foreground (good for testing)
npm run dev

# Test it's running:
curl http://localhost:8080/health
```

**Option B: Production Mode with PM2 (Recommended)**

```bash
# Install PM2 globally (if not done)
sudo npm install -g pm2

# Start backend with PM2
pm2 start npm --name "clone2ghl-backend" -- run start

# View logs
pm2 logs clone2ghl-backend

# Monitor
pm2 monit

# Auto-restart on reboot
pm2 startup
pm2 save
```

### Step 6: Configure SSL Certificate

**Using Let's Encrypt (free):**

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --standalone -d api.yourdomain.com

# Auto-renewal (runs daily)
sudo certbot renew --dry-run
```

### Step 7: Set Up Reverse Proxy (HTTPS)

**Install Nginx:**
```bash
sudo apt install -y nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/clone2ghl-backend
```

**Nginx Configuration:**
```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

**Enable the site:**
```bash
sudo ln -s /etc/nginx/sites-available/clone2ghl-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 8: Verify Backend is Live

```bash
# From your local machine:
curl https://api.yourdomain.com/health

# Should return JSON response like:
# {"status":"ok","timestamp":"2026-05-24T..."}
```

---

## Extension Setup

### Step 1: Generate Icons

1. Open `extension/icons/make_icons.html` in your browser
2. Click **"Generate & Download All Icons"**
3. Move 3 files into `extension/icons/`:
   - `icon16.png`
   - `icon48.png`
   - `icon128.png`

### Step 2: Create Setup Instructions for Users

Create a `SETUP_GUIDE.md` file users will follow:

```markdown
# Clone2GHL Setup Instructions

## Step 1: Install Extension in Developer Mode

1. Open Chrome and go to: `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load Unpacked**
4. Select the `extension/` folder from the provided files
5. You should see "Clone2GHL" with a gold icon

## Step 2: Configure API Keys

1. Click the Clone2GHL icon in your toolbar
2. Click **Settings** tab
3. Enter your API keys:
   - **OpenAI API Key** (required)
   - **GoHighLevel API Key** (required)
   - **GoHighLevel Location ID** (required)
4. Click **Save**

## Step 3: Connect to Backend

1. Click **Cloud Backend** tab
2. Enter Backend URL: `https://api.yourdomain.com`
3. Create account or sign in
4. Click **Refresh Usage** to verify connection

## Step 4: Test the Extension

1. Visit any landing page
2. You should see a **Clone to GHL** button (bottom-right)
3. Click it and test the cloning process

## Support

For help, see USER_GUIDE.md or contact: support@yourdomain.com
```

### Step 3: Create User Distribution Package

Create a folder users will download containing:

```
clone2ghl-setup/
├── extension/              # Full extension folder
├── SETUP_GUIDE.md          # Step-by-step instructions
├── API_KEY_GUIDE.md        # How to get API keys
├── TROUBLESHOOTING.md      # Common issues & fixes
└── README.md               # Welcome & overview
```

---

## User Distribution

### How Users Get the Extension

**Option 1: Download Package (Recommended)**
1. Create ZIP file with setup files above
2. Host on your website or send via email
3. Users download, extract, and follow SETUP_GUIDE.md

**Option 2: GitHub Repository**
1. Create public or private GitHub repo
2. Add SETUP_GUIDE.md in root
3. Share repo link with users

**Option 3: In-Person Setup**
1. Walk clients through setup during onboarding call
2. Screen share and do it together
3. Ensure they test before you hang up

### Creating Distribution Package

```bash
# Create ZIP for distribution
cd /path/to/Clone2GHL_CE
zip -r clone2ghl-client-setup.zip extension/ SETUP_GUIDE.md USER_GUIDE.md PRIVACY_POLICY.md
```

**Share via:**
- Email (if <25MB)
- Google Drive / OneDrive
- Your website (password protected)
- GitHub (private repo)
- Dropbox

---

## Post-Launch Support

### Support Structure

**Tier 1: Self-Service**
- USER_GUIDE.md (troubleshooting section)
- FAQ on your website
- Setup video tutorials

**Tier 2: Email Support**
- support@yourdomain.com
- Response SLA: 24 hours
- Use response templates (see Appendix)

**Tier 3: Escalation**
- Technical lead investigates bugs
- Potential hot fix deployment
- Direct communication with client

### Monitoring & Metrics

**Track Weekly:**
- [ ] Number of active users
- [ ] Support tickets received
- [ ] Error log monitoring
- [ ] Backend uptime (99%+ target)

**Track Monthly:**
- [ ] Feature usage (which ones used most)
- [ ] User retention
- [ ] Error rate trends
- [ ] Performance metrics

---

## Maintenance & Updates

### Security Updates

**Immediate Action (within 24 hours):**
- Critical vulnerabilities in dependencies
- Security breaches or exploits
- Data privacy incidents

**Process:**
1. Identify vulnerability
2. Apply fix to code
3. Update version number (PATCH bump)
4. Deploy to production
5. Email users about update

### Regular Maintenance

**Weekly:**
- [ ] Review error logs
- [ ] Check backend health
- [ ] Monitor disk space

**Monthly:**
- [ ] Update npm packages: `npm update`
- [ ] Check for security issues: `npm audit`
- [ ] Database maintenance/optimization
- [ ] Backup verification

**Quarterly:**
- [ ] Major feature releases (if planned)
- [ ] Performance optimization review
- [ ] Security audit

### Version Management

**Numbering:** MAJOR.MINOR.PATCH (e.g., 1.0.1)

- **MAJOR:** Breaking changes (new features, major redesign)
- **MINOR:** New features (non-breaking)
- **PATCH:** Bug fixes

**Update manifest.json:**
```json
{
  "manifest_version": 3,
  "version": "1.0.2",
  ...
}
```

---

## Troubleshooting

### Common Backend Issues

**Backend won't start**
- Check Node.js installed: `node --version`
- Verify .env variables: `cat .env | head -20`
- Check port not in use: `lsof -i :8080`
- Review logs: `pm2 logs clone2ghl-backend`

**Connection refused**
- Verify backend is running: `curl http://localhost:8080/health`
- Check firewall: `sudo ufw status`
- Verify CORS_ORIGIN in .env

**SSL certificate errors**
- Verify cert path in Nginx config
- Check cert expiration: `sudo certbot certificates`
- Renew if needed: `sudo certbot renew`

### Common Extension Issues

**"Extension won't load"**
- Verify icons exist in extension/icons/
- Check manifest.json syntax
- Clear Chrome cache and reload

**"API key invalid"**
- Verify key format (no extra spaces)
- Confirm key hasn't been revoked
- Try with different key to test

**"Backend connection fails"**
- Verify backend URL includes https://
- Check CORS_ORIGIN in backend .env
- Test with: `curl https://api.yourdomain.com/health`

**"Clone button doesn't appear"**
- Not all sites are recognized as funnels
- Use Dashboard method instead (Dashboard → My Funnels → Paste URL)

---

## Appendices

### Appendix A: Common Support Questions & Answers

**Q: How do I get my API keys?**
A: See SETUP_GUIDE.md - includes step-by-step instructions for OpenAI and GoHighLevel

**Q: The backend appears offline**
A: SSH into server and run: `pm2 logs clone2ghl-backend` to check error

**Q: Can I clone large pages?**
A: Large pages take longer. If timeout occurs, try a simpler page first, or increase backend timeout setting

**Q: How do I backup my data?**
A: Set up automated database backups:
```bash
# For MongoDB Atlas: use built-in backups
# For local database, use cron job:
0 2 * * * /path/to/backup-script.sh
```

### Appendix B: SSL Certificate Management

**Check expiration:**
```bash
sudo certbot certificates
```

**Renew manually:**
```bash
sudo certbot renew
```

**Auto-renewal status:**
```bash
sudo systemctl status certbot.timer
```

### Appendix C: Performance Optimization

**Backend optimization:**
- Enable gzip compression in Express
- Use database indexes on queried fields
- Cache API responses (Redis optional)
- Monitor slow queries

**Extension optimization:**
- Lazy load dashboard components
- Cache cloned funnels locally
- Compress images before upload
- Minimize file sizes

### Appendix D: Database Setup

**MongoDB:**
```bash
# Local installation
docker run -d -p 27017:27017 --name mongo mongo:latest

# Atlas (cloud, recommended)
# Create at mongodb.com/atlas, get connection string
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
```

**PostgreSQL:**
```bash
# Local installation
sudo apt install -y postgresql postgresql-contrib

# Create database
sudo -u postgres createdb clone2ghl
sudo -u postgres createuser clone2ghl_user
```

### Appendix E: Backup Strategy

**Daily backups:**
```bash
#!/bin/bash
# backup-script.sh
BACKUP_DIR="/backups/clone2ghl"
DATE=$(date +%Y%m%d)

# MongoDB backup
mongodump --uri "$MONGODB_URI" --out "$BACKUP_DIR/mongo_$DATE"

# Keep last 30 days
find "$BACKUP_DIR" -type d -mtime +30 -exec rm -rf {} \;
```

---

## Sign-Off & Verification

**Confirm before going live:**

- [ ] Backend running and accessible at https://api.yourdomain.com/health
- [ ] Database connection verified
- [ ] SSL certificate valid
- [ ] Extension loads without errors in dev mode
- [ ] API keys configured and tested
- [ ] User distribution package created
- [ ] Support email set up and monitored
- [ ] Privacy policy and terms reviewed
- [ ] Monitoring/alerting configured
- [ ] Backup strategy in place

---

## Quick Reference

| Task | Command |
|------|---------|
| Check backend status | `curl https://api.yourdomain.com/health` |
| View logs | `pm2 logs clone2ghl-backend` |
| Restart backend | `pm2 restart clone2ghl-backend` |
| Update dependencies | `npm update` |
| Check security | `npm audit` |
| Database backup | See Appendix E |

---

**Document Version:** 1.0 (Local Edition)  
**Updated:** May 24, 2026  
**Maintained by:** [Your Team]
