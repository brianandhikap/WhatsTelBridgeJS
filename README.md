## Whatsapp-Bridge-Telegram-JS
Forwading chat dari Whatsapp ke Telegram

## Screnshoot
| | | |
|---|---|---|
| <img src="https://raw.githubusercontent.com/brianandhikap/WhatsTelBridgeJS/main/screenshot/1.jpg" width="200"/> | <img src="https://raw.githubusercontent.com/brianandhikap/WhatsTelBridgeJS/main/screenshot/2.jpg" width="200"/> | <img src="https://raw.githubusercontent.com/brianandhikap/WhatsTelBridgeJS/main/screenshot/3.jpg" width="200"/> |

## Tutorial
1. Clone repository:
   ```bash
   git clone https://github.com/brianandhikap/WhatsTelBridgeJS
   
2. Install
   ```bash
   npm init -y
   npm i

3. Copy dan Edit .env
   ```bash
   BOT Token
   Group ID
   Topic ID buat chat nya
   Topic ID Status buat story nya biar di pisah by topic
   ID SUPER ADMIN

4. RUNNNN
   ```bash
   node index.js

   # atau pakai PM2 (biar gak ribet buat baut servicenya)
   npm install -g pm2
   pm2 start ecosystem.config.js

5. Scan QR DI TELEGRAM!!!...

6. STOP PM2
   ```bash
   pm2 stop WhatsTelBridgeJS
   pm2 delete WhatsTelBridgeJS

### DONE BANG!!!


- Command SuperAdmin:
- /help
- /syscontact - Menyinkronkan kontak dari WhatsApp
- /show_contact - Menampilkan semua kontak
- /show_admin - Menampilkan semua admin
- /show_user - Menampilkan semua pengguna dalam grup Telegram
- /add_admin [ID] - Menambahkan admin baru
- /remove_admin [ID] - Menghapus admin
- /chat_[telepon] [pesan] - Mengirim pesan langsung ke nomor WhatsApp

### NOTE: CUMAN BISA DI PAKAI SAMA SUPERADMIN, Admin biasa cuman bisa reply chat di group saja dan akan ke forward ke WA. Group WAJIB HUKUMNYA BER TOPIC.

- Butuh bantuan? DM IG [@brianandhikap](https://instagram.com/brianandhikap)
- Skip Stiker...

### Star repo itu GRATIS...
