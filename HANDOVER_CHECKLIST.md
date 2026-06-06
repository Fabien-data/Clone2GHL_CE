# Clone2GHL — Local-Only Deployment Checklist
**Quick Reference for Self-Hosted Backend + Dev Mode Extension**

---

## 📦 Phase 1: Pre-Handover (Developer)

### Verification Tasks
- [ ] Icons generated: `extension/icons/` contains 16.png, 48.png, 128.png
- [ ] No hardcoded API keys in any source files
- [ ] manifest.json version matches release version
- [ ] All test data removed from backend
- [ ] Environment variables documented in .env.example
- [ ] Privacy policy is Chrome Web Store compliant (see CWS_REVIEW_ACTION_PLAN.md)
- [ ] README and documentation updated with client branding
- [ ] All security tests passed
- [ ] Backend tested with and without database

### Access & Credentials Prepared
- [ ] Client GitHub account has repo access
- [ ] Source code repository cloned/transferred
- [ ] Any deployment credentials/URLs documented
- [ ] Third-party service credentials (OpenAI, GHL, HeyGen) access instructions provided

---

## 🎯 Phase 2: Client Setup (Client Actions)

### 1. Credentials & Infrastructure (Day 1)
- [ ] Create/secure GoHighLevel API key
  - Steps: GoHighLevel → Settings → Private Integrations → Create API Key
  - Copy Location ID from Business Profile
- [ ] Create OpenAI API key
  - URL: platform.openai.com/api-keys
  - Enable billing on account
- [ ] Create HeyGen API key (optional, if video generation needed)
- [ ] Create Stripe account (optional, if offering paid plans)

### 2. Backend Setup (Self-Hosted)
- [ ] Choose hosting (AWS, DigitalOcean, Heroku, etc.)
- [ ] Set up server/database:
  - [ ] Node.js v16+ installed
  - [ ] 2GB+ RAM, 20GB+ storage
  - [ ] SSL certificate obtained (Let's Encrypt free)
  - [ ] Domain/subdomain configured (api.yourdomain.com)
- [ ] Clone backend repository
- [ ] Create `.env` file with variables:
  - [ ] PORT, NODE_ENV, JWT_SECRET
  - [ ] OPENAI_API_KEY, HEYGEN_API_KEY
  - [ ] MONGODB_URI or PostgreSQL_URL
  - [ ] STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY
  - [ ] CORS_ORIGIN set to client domain
- [ ] Install dependencies: `npm install`
- [ ] Test locally: `npm run dev`
- [ ] Deploy to production
- [ ] Configure monitoring/error tracking (Sentry, etc.)
- [ ] Set up database backups

### 4. Extension Configuration
- [ ] Generate icons (extension/icons/make_icons.html)
- [ ] Load extension in Chrome dev mode:
  - [ ] chrome://extensions
  - [ ] Enable Developer Mode
  - [ ] "Load unpacked" → select extension/ folder
- [ ] Test extension loads without errors
- [ ] Configure API keys in extension Settings tab
- [ ] Set backend URL in Cloud Backend settings
- [ ] Test cloning a sample webpage
- [ ] Test export to GoHighLevel

### 5. Create User Distribution Package
- [ ] Create SETUP_GUIDE.md for users
- [ ] Create API_KEY_GUIDE.md 
- [ ] Create TROUBLESHOOTING.md
- [ ] Package extension folder into ZIP
- [ ] Host distribution package on website
- [ ] Test download and setup process

### 6. Documentation Updates
- [ ] Update PRIVACY_POLICY.md with client domain/branding
- [ ] Update terms-and-conditions.html with client company name
- [ ] Customize USER_GUIDE.md with support contact info
- [ ] Update support email addresses in extension manifest (if applicable)
- [ ] Create FAQ based on common questions

### 6. Support Infrastructure
- [ ] Set up support email (support@yourdomain.com)
- [ ] Create FAQ/knowledge base
- [ ] Set up GitHub Issues or bug tracking system
- [ ] Create status page (optional)
- [ ] Draft support SLA (response times, escalation)
- [ ] Train support team on USER_GUIDE.md
- [ ] Create support templates for common issues

---

## ✅ Phase 3: Pre-Launch Testing (Client)

### Backend Tests
- [ ] Backend starts without errors: `npm run dev`
- [ ] Health check responds: `curl http://localhost:8080/health`
- [ ] User registration works
- [ ] Login with email/password works
- [ ] JWT token generation works
- [ ] API key validation endpoints work
- [ ] Database reads and writes working
- [ ] Error handling returns proper status codes

### Extension + Backend Integration Tests
- [ ] Extension loads without errors
- [ ] All settings fields accept input and save
- [ ] Backend URL field accepts https URL
- [ ] Backend connection test passes (Settings tab)
- [ ] User can register through extension
- [ ] User can log in through extension
- [ ] Clone a test webpage successfully
- [ ] Test AI optimization feature
- [ ] Test export to GoHighLevel
- [ ] All buttons and links functional

### Environment Tests
- [ ] Works on Windows, Mac, Linux (backend)
- [ ] Works on Chrome 90+ (extension)
- [ ] Works with HTTPS backend connection
- [ ] Works with different API keys
- [ ] Tested in new user scenario (fresh install)

### Security Tests
- [ ] No sensitive data in localStorage
- [ ] API keys encrypted in storage
- [ ] HTTPS enforced for all external calls
- [ ] CORS headers properly configured
- [ ] No console warnings or errors
- [ ] Database credentials not exposed

---

## 🚀 Phase 4: Launch

### Pre-Launch (Day Before)
- [ ] Backend running and verified at https://api.yourdomain.com/health
- [ ] All tests passing (extension + backend connectivity)
- [ ] Database backup created
- [ ] Support team briefed and ready
- [ ] User setup guide finalized
- [ ] Launch communication written and ready to send
- [ ] Monitoring/alerts configured
- [ ] Rollback plan documented

### Launch Day
- [ ] Backend deployed to production (if not already live)
- [ ] Extension distribution package ready
- [ ] Send launch announcement with setup instructions
- [ ] Monitor support tickets and error logs
- [ ] Respond to initial user setup questions
- [ ] Verify metrics are being tracked correctly

### Post-Launch (First Week)
- [ ] Daily monitoring of support tickets
- [ ] Fix critical bugs immediately
- [ ] Document common setup questions for FAQ
- [ ] Monitor backend performance and uptime
- [ ] Respond to user feedback
- [ ] Verify all users can load extension successfully

---

## 📊 Phase 5: Ongoing Operations

### Weekly
- [ ] Review support tickets
- [ ] Check error logs for new issues
- [ ] Monitor system performance
- [ ] Update FAQ with new questions

### Monthly
- [ ] Review metrics (active users, features used, churn)
- [ ] Plan next version features
- [ ] Security updates for dependencies
- [ ] Database cleanup/optimization

### Quarterly
- [ ] Major feature release (if planned)
- [ ] Security audit
- [ ] User feedback review
- [ ] Roadmap update
- [ ] Performance optimization review

---

## 📞 Support Contact Matrix

| Issue Type | First Contact | Escalation | Timeline |
|-----------|---------------|------------|----------|
| Installation problem | Support email | Tech lead | 24 hours |
| API key setup | FAQ → Email | Developer | 24 hours |
| Feature request | Feedback form | Product team | 48 hours |
| Critical bug | Tech lead | Developer | 1-4 hours |
| Privacy/compliance | Legal | Compliance officer | 24 hours |

---

## 🆘 Common Handover Issues & Quick Fixes

| Issue | Cause | Solution |
|-------|-------|----------|
| Extension doesn't load | Icons missing | Run extension/icons/make_icons.html |
| "Invalid API key" error | GHL key from wrong section | Use Private Integrations, not Integrations tab |
| Backend won't start | .env variables missing | Copy .env.example to .env and fill values |
| Export times out | Large page | Try smaller page or check internet connection |
| Web Store rejected | Privacy policy issues | See CWS_REVIEW_ACTION_PLAN.md |
| Clone button doesn't appear | Not a recognized funnel | Use Dashboard clone option instead |

---

## 📁 Important Files Quick Reference

| File/Folder | Purpose | Action |
|-----------|---------|--------|
| CLIENT_HANDOVER_GUIDE.md | Detailed handover instructions | Read first |
| INSTALL.md | Installation guide | Share with support team |
| USER_GUIDE.md | End-user documentation | Publish on website |
| PRIVACY_POLICY.md | Legal compliance | Update with your domain |
| extension/icons/make_icons.html | Icon generator | Run once at setup |
| webstore-kit/ | Chrome Web Store files | Use for store submission |
| backend/.env.example | Backend configuration | Copy to .env and fill in |

---

## ✍️ Sign-Off

**Client Representative:** ___________________  
**Date:** ___________________  

**Developer/Handover Manager:** ___________________  
**Date:** ___________________  

---

**Handover Status:** [ ] Complete [ ] In Progress [ ] Not Started

**Next Review Date:** ___________________

**Notes:**
_________________________________________________________________

_________________________________________________________________

_________________________________________________________________
