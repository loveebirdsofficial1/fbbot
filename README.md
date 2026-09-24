# OmniInbox — Facebook Messenger + Instagram + WhatsApp ka ek hi inbox

Aik dashboard jis mein Facebook Page, Instagram DM aur WhatsApp ke saare messages
aate hain, aur aap ke agents wahin se reply karte hain. Teeno channels Meta ke
hain, is liye ek hi Meta App + ek hi webhook URL kaam karti hai.

## Tech

- **Backend**: Node.js (Express) + SQLite (built-in `node:sqlite`, koi DB install nahi)
- **Frontend**: React + Vite
- **Realtime**: Server-Sent Events (messages turant aate hain)
- **Auth**: JWT (agents ke liye alag logins)

## Requirement

- Node.js **>= 22** (tested on 24)
- [ngrok](https://ngrok.com) ya koi public HTTPS URL (Meta webhook ke liye)
- Meta Developer account + App (banned? nahi — free)

## Quick start

```bash
# 1) dependencies
npm install

# 2) env file banao (already exists in this copy)
copy .env.example .env      # Windows
# .env mein apne tokens daalo

# 3) server + client
npm run dev:server          # terminal 1 - backend (port 4000)
npm run dev:client          # terminal 2 - frontend (port 5173)

# ya sirf production build wala UI (political - ek hi port)
npm run build
npm start                   # http://localhost:4000
```

Login: `admin@omnichannel.local` / `admin123` (pehli dafa se automatically bana diya jata hai).

---

## 1) Facebook Messenger connect

### a. Token lo (long-lived, zaroori)

1. [developers.facebook.com](https://developers.facebook.com/) → apna App → **Tools > Graph API Explorer**
2. App select karo, permission `pages_messaging`, `pages_show_list`, `pages_read_engagement`
3. Token generate karne ke liye `Get Token > Page Access Token` apni page choose karo
4. Short token hai (1 ghante ka) — us ko **long-lived** (60 din) banao:

```
GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=SHORT_LIVED_TOKEN
```

5. `.env` mein daalo:

```
PAGE_ACCESS_TOKEN=<long_lived_token>
PAGE_ID=<your_page_id>
APP_SECRET=<your_app_secret>
VERIFY_TOKEN=koi_bhi_apna_secret
```

### b. Webhook subscribe karo

1. **Public URL chahiye** — us waqt ke liye ngrok:

```bash
ngrok http 4000
# mil jayega: https://xxxx.ngrok-free.app  -> webhook URL = https://xxxx.ngrok-free.app/webhook
```

2. Meta App → **Webhooks** → **Add callback URL**:
   - Callback URL: `https://xxxx.ngrok-free.app/webhook`
   - Verify token: `.env` ka `VERIFY_TOKEN` (yehi likhna jo aapne .env mein set kiya)

3. **Facebook** tab → apni Page subscribe karo, field **`messages`** select kar ke **Verify and save**.

> Har baar jab `.env` mein VERIFY_TOKEN badalna ho, Meta par bhi wahi token DENA zaroori hai.

### c. Test

- Messenger se apni page ko message karo → dashboard mein conversation aa jayegi.
- Reply bhejoge to wahi likh kar send hoga.

---

## 2) Instagram DM connect (optional)

1. Page access pe Panth pe `instagram_basic` + `instagram_manage_messages` permissions App se
2. Instagram account apne Meta App ke Business Portfolio se link karein
3. Graph API Explorer → **Instagram Graph API** → `Get Token` → Instagram account choose karke
   permanent token copy karo → `.env` ka `IG_ACCESS_TOKEN`
4. Meta App → **Webhooks → Instagram** → callback URL same (`/webhook`) + verify token
   → field **`messages`** subscribe

---

## 3) WhatsApp connect (optional)

1. [developers.facebook.com](https://developers.facebook.com/) → App → **WhatsApp** product
   → **Get started** → phone number verify karo
2. Milenge: `Phone number ID`, `WABA ID`, aur **Access token** → `.env`:

```
WA_ACCESS_TOKEN=<token>
WA_PHONE_NUMBER_ID=<phone_number_id>
WA_OWN_NUMBER=<apna_number_without_+55 e.g. 15551234567>
```

3. Meta App → **Webhooks → WhatsApp** → callback URL same + verify token → subscribe
   (WhatsApp Business Account select karo, field `messages`)

---

## Agents

- Har agent ka apna login bana sakte ho (admin ke role se, `POST /api/auth/agents`)
- Conversations ko assign karo agent ko, status Open/Pending/Resolved rakho
- Unread count har channel ke liye alag

## API (short)

| Method | Endpoint | Kaam |
|---|---|---|
| POST | `/webhook` | Meta ke saare channel events yahan aate hain |
| GET | `/webhook?hub.verify_token=…` | Meta subscription verification |
| POST | `/api/auth/login` | agent login → JWT |
| GET | `/api/conversations?channel=&status=` | inbox list |
| GET | `/api/conversations/:id` | thread |
| POST | `/api/conversations/:id/reply` | reply bhejo |
| POST | `/api/conversations/:id/status` | status badlo |
| POST | `/api/conversations/:id/assign` | agent assign |
| GET | `/api/stream` | SSE realtime |

## Security notes

- `.env` kabhi kisi ke saath share nahi karna (gitignored hai)
- Page token short-lived hota hai — 60 din mein refresh karna parhta hai
- `APP_SECRET` set karo taake webhook signature verify ho (extra protection)
- Production: `JWT_SECRET` strong rakhna, admin password zaroor change karna