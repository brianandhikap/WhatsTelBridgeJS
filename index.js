const { Client, MessageMedia } = require("whatsapp-web.js")
const { LocalAuth } = require("whatsapp-web.js")
const TelegramBot = require("node-telegram-bot-api")
const qrcode = require("qrcode")
const fs = require("fs")
const path = require("path")
const sqlite3 = require("sqlite3")
const { open } = require("sqlite")
const dotenv = require("dotenv")
const https = require("https")
const http = require("http")

dotenv.config()

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID
const TELEGRAM_TOPIC_ID = process.env.TELEGRAM_TOPIC_ID
const TELEGRAM_TOPIC_ID_STATUS = process.env.TELEGRAM_TOPIC_ID_STATUS
const DEFAULT_ADMIN_ID = process.env.DEFAULT_ADMIN_ID

let db
const admins = new Set([DEFAULT_ADMIN_ID])

let isRestarting = false

const tempDir = path.join(__dirname, "temp")
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir)
}

const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, ".wwebjs_auth"),
  }),
  puppeteer: {
    args: ["--no-sandbox"],
    headless: true,
  },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  clientName: "Google Chrome (WhatsTelBridgeJS)",
})

const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

function splitMessage(text, maxLength = 4000) {
  const chunks = []
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.substring(i, i + maxLength))
  }
  return chunks
}

function restartApplication() {
  if (isRestarting) return

  isRestarting = true
  console.log("Restarting application...")

  telegramBot
    .sendMessage(
      TELEGRAM_GROUP_ID,
      "WhatsApp connection lost. Restarting the application to generate a new QR code...",
      { message_thread_id: TELEGRAM_TOPIC_ID },
    )
    .finally(() => {
      if (db) {
        db.close().catch((err) => console.error("Error closing database:", err))
      }

      setTimeout(() => {
        process.exit(1)
      }, 3000)
    })
}

async function initializeDatabase() {
  db = await open({
    filename: "./contacts.db",
    driver: sqlite3.Database,
  })

  await db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY,
      name TEXT
    );
    
    CREATE TABLE IF NOT EXISTS admins (
      telegram_id TEXT PRIMARY KEY
    );
  `)

  const savedAdmins = await db.all("SELECT telegram_id FROM admins")
  savedAdmins.forEach((admin) => admins.add(admin.telegram_id))

  admins.add(DEFAULT_ADMIN_ID)
}

whatsappClient.on("qr", async (qr) => {
  try {
    const qrImagePath = path.join(tempDir, "qrcode.png")
    await qrcode.toFile(qrImagePath, qr, {
      scale: 8,
      margin: 4,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })

    await telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Scan QR nya kak.", {
      message_thread_id: TELEGRAM_TOPIC_ID,
    })

    await telegramBot.sendPhoto(TELEGRAM_GROUP_ID, qrImagePath, {
      caption: "Scan itu kak.",
      message_thread_id: TELEGRAM_TOPIC_ID,
    })

    setTimeout(() => {
      try {
        fs.unlinkSync(qrImagePath)
      } catch (err) {
        console.error("Error deleting QR code file:", err)
      }
    }, 60000)
  } catch (error) {
    console.error("Error generating QR code:", error)
    telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Error generating QR code. Please restart the bot.", {
      message_thread_id: TELEGRAM_TOPIC_ID,
    })
  }
})

whatsappClient.on("ready", () => {
  console.log("WhatsApp client is ready!")
  telegramBot.sendMessage(TELEGRAM_GROUP_ID, "WhatsApp sudah konek kak.", {
    message_thread_id: TELEGRAM_TOPIC_ID,
  })
})

whatsappClient.on("disconnected", (reason) => {
  console.log("WhatsApp disconnected:", reason)
  telegramBot
    .sendMessage(TELEGRAM_GROUP_ID, `WhatsApp disconnected: ${reason}. Restarting application...`, {
      message_thread_id: TELEGRAM_TOPIC_ID,
    })
    .finally(() => {
      restartApplication()
    })
})

whatsappClient.on("auth_failure", (reason) => {
  console.log("WhatsApp authentication failed:", reason)
  telegramBot
    .sendMessage(TELEGRAM_GROUP_ID, `WhatsApp authentication failed: ${reason}. Restarting application...`, {
      message_thread_id: TELEGRAM_TOPIC_ID,
    })
    .finally(() => {
      restartApplication()
    })
})

async function sendMediaToTelegram(media, messageHeader, messageBody, topicId) {
  const caption = messageHeader + (messageBody || "") + "\n\n<i>Reply pesan ini untuk membalas</i>"
  const options = {
    caption: caption,
    parse_mode: "HTML",
    message_thread_id: topicId,
  }

  const buffer = Buffer.from(media.data, "base64")

  try {
    if (media.mimetype.startsWith("image/")) {
      return telegramBot.sendPhoto(TELEGRAM_GROUP_ID, buffer, options)
    } else if (media.mimetype.startsWith("video/")) {
      const videoPath = path.join(tempDir, `video_${Date.now()}.mp4`)
      fs.writeFileSync(videoPath, buffer)

      const result = await telegramBot.sendVideo(TELEGRAM_GROUP_ID, videoPath, options)

      setTimeout(() => {
        try {
          fs.unlinkSync(videoPath)
        } catch (err) {
          console.error("Error deleting video file:", err)
        }
      }, 60000)

      return result
    } else if (media.mimetype.startsWith("audio/")) {
      return telegramBot.sendAudio(TELEGRAM_GROUP_ID, buffer, options)
    } else if (media.mimetype === "application/pdf") {
      return telegramBot.sendDocument(TELEGRAM_GROUP_ID, buffer, options)
    } else {
      return telegramBot.sendDocument(TELEGRAM_GROUP_ID, buffer, {
        ...options,
        filename: media.filename || `file.${media.mimetype.split("/")[1] || "unknown"}`,
      })
    }
  } catch (error) {
    console.error(`Error sending media (${media.mimetype}):`, error)
    return telegramBot
      .sendDocument(TELEGRAM_GROUP_ID, buffer, {
        ...options,
        filename: media.filename || `file.${media.mimetype.split("/")[1] || "unknown"}`,
      })
      .catch((err) => {
        console.error("Error sending document fallback:", err)
        return telegramBot.sendMessage(
          TELEGRAM_GROUP_ID,
          `${messageHeader}[Media tidak dapat dikirim: ${media.mimetype}]\n${messageBody || ""}`,
          {
            parse_mode: "HTML",
            message_thread_id: topicId,
          },
        )
      })
  }
}

whatsappClient.on("message", async (message) => {
  try {
    if (message.hasMedia) {
      const media = await message.downloadMedia()
      if (media && media.mimetype === "image/webp") {
        console.log("Skipping sticker message")
        return
      }
    }

    const contact = await message.getContact()
    const chat = await message.getChat()

    let contactName = "Unknown"
    const contactRecord = await db.get("SELECT name FROM contacts WHERE phone = ?", [contact.number])
    if (contactRecord) {
      contactName = contactRecord.name
    } else {
      if (contact.name) {
        contactName = contact.name
        await db.run("INSERT OR REPLACE INTO contacts (phone, name) VALUES (?, ?)", [contact.number, contact.name])
      }
    }

    const messageHeader = `<b>Dari:</b> ${contactName}\n<b>No HP:</b> ${contact.number}\n\n`

    const topicId = message.isStatus ? TELEGRAM_TOPIC_ID_STATUS : TELEGRAM_TOPIC_ID

    if (message.hasMedia) {
      const media = await message.downloadMedia()

      if (media) {
        await sendMediaToTelegram(media, messageHeader, message.body, topicId)
      }
    } else {
      await telegramBot.sendMessage(
        TELEGRAM_GROUP_ID,
        messageHeader + message.body + "\n\n<i>Reply pesan ini untuk membalas</i>",
        {
          parse_mode: "HTML",
          message_thread_id: topicId,
        },
      )
    }
  } catch (error) {
    console.error("Error handling WhatsApp message:", error)
    telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Error handling WhatsApp message: ${error.message}`, {
      message_thread_id: TELEGRAM_TOPIC_ID,
      parse_mode: "HTML",
    })
  }
})

whatsappClient.on("message_create", async (message) => {
  if (message.isStatus && message.fromMe) {
    try {
      if (message.hasMedia) {
        const media = await message.downloadMedia()
        if (media && media.mimetype === "image/webp") {
          console.log("Skipping sticker status")
          return
        }
      }

      const contact = await message.getContact()

      const messageHeader = `<b>Status Update</b>\n<b>From:</b> You\n\n`

      if (message.hasMedia) {
        const media = await message.downloadMedia()

        if (media) {
          await sendMediaToTelegram(media, messageHeader, message.body, TELEGRAM_TOPIC_ID_STATUS)
        }
      } else {
        await telegramBot.sendMessage(TELEGRAM_GROUP_ID, messageHeader + message.body, {
          parse_mode: "HTML",
          message_thread_id: TELEGRAM_TOPIC_ID_STATUS,
        })
      }
    } catch (error) {
      console.error("Error handling WhatsApp status:", error)
      telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Error handling WhatsApp status: ${error.message}`, {
        message_thread_id: TELEGRAM_TOPIC_ID_STATUS,
        parse_mode: "HTML",
      })
    }
  }
})

async function downloadTelegramFile(fileId) {
  const fileLink = await telegramBot.getFileLink(fileId)
  const response = await fetch(fileLink)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}

async function sendWhatsAppMessage(phone, message, replyMsgId = null, topicId = TELEGRAM_TOPIC_ID) {
  try {
    let formattedPhone = phone.toString().trim()
    if (formattedPhone.startsWith("+")) {
      formattedPhone = formattedPhone.substring(1)
    }

    if (!/^\d+$/.test(formattedPhone)) {
      throw new Error("Invalid phone number format")
    }

    await whatsappClient.sendMessage(`${formattedPhone}@c.us`, message)

    const sentMsg = await telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Message sent to ${formattedPhone}`, {
      reply_to_message_id: replyMsgId,
      message_thread_id: topicId,
      parse_mode: "HTML",
    })

    setTimeout(() => {
      telegramBot
        .deleteMessage(TELEGRAM_GROUP_ID, sentMsg.message_id)
        .catch((err) => console.error("Error deleting message:", err))
    }, 5000)

    return true
  } catch (error) {
    console.error(`Error sending WhatsApp message to ${phone}:`, error)

    await telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Error sending message to ${phone}: ${error.message}`, {
      reply_to_message_id: replyMsgId,
      message_thread_id: topicId,
      parse_mode: "HTML",
    })

    return false
  }
}

telegramBot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    const isSuperAdmin = userId === DEFAULT_ADMIN_ID

    if (msg.text && msg.text.startsWith("/chat_") && chatId.toString() === TELEGRAM_GROUP_ID) {
      if (!admins.has(userId)) {
        telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Anda tidak memiliki izin untuk menggunakan perintah ini", {
          reply_to_message_id: msg.message_id,
          message_thread_id: TELEGRAM_TOPIC_ID,
          parse_mode: "HTML",
        })
        return
      }

      const commandText = msg.text.substring(6)
      const firstSpaceIndex = commandText.indexOf(" ")

      if (firstSpaceIndex === -1) {
        telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Format perintah salah. Gunakan: /chat_[nomor] [pesan]", {
          reply_to_message_id: msg.message_id,
          message_thread_id: TELEGRAM_TOPIC_ID,
          parse_mode: "HTML",
        })
        return
      }

      const phone = commandText.substring(0, firstSpaceIndex)
      const message = commandText.substring(firstSpaceIndex + 1)

      if (!message || message.trim() === "") {
        telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Pesan tidak boleh kosong", {
          reply_to_message_id: msg.message_id,
          message_thread_id: TELEGRAM_TOPIC_ID,
          parse_mode: "HTML",
        })
        return
      }

      await sendWhatsAppMessage(phone, message, msg.message_id, TELEGRAM_TOPIC_ID)
      return
    }

    if (msg.text && msg.text.startsWith("/") && msg.chat.type === "private") {
      const command = msg.text.split(" ")[0]
      const args = msg.text.substring(command.length).trim()

      if (command === "/start" || command === "/help") {
        const helpText = `
<b>WhatsTelBridgeJS</b>

<b>Command Admin (dalam grup):</b>
/chat_[telepon] [pesan] - Mengirim pesan langsung ke nomor WhatsApp

<b>Command Supe rAdmin (PM BOT):</b>
/syscontact - Menyinkronkan kontak dari WhatsApp
/show_contact - Menampilkan semua kontak
/show_admin - Menampilkan semua admin
/show_user - Menampilkan semua pengguna dalam grup Telegram
/add_admin [ID] - Menambahkan admin baru
/remove_admin [ID] - Menghapus admin

<b>Catatan:</b> Command hanya dapat digunakan Admin.
`
        return telegramBot.sendMessage(chatId, helpText, { parse_mode: "HTML" })
      }

      if (!isSuperAdmin) {
        return telegramBot.sendMessage(
          chatId,
          "Anda tidak memiliki izin untuk menggunakan perintah ini. Hanya Super Admin yang dapat menggunakan perintah ini.",
        )
      }

      switch (command) {
        case "/syscontact":
          telegramBot.sendMessage(chatId, "Syncing contacts...")
          const waContacts = await whatsappClient.getContacts()
          let syncCount = 0

          for (const contact of waContacts) {
            if (contact.name && contact.number) {
              await db.run("INSERT OR REPLACE INTO contacts (phone, name) VALUES (?, ?)", [
                contact.number,
                contact.name,
              ])
              syncCount++
            }
          }

          telegramBot.sendMessage(chatId, `Synced ${syncCount} contacts successfully!`)
          break

        case "/add_admin":
          if (!args) {
            return telegramBot.sendMessage(chatId, "Please provide a Telegram user ID")
          }

          await db.run("INSERT OR REPLACE INTO admins (telegram_id) VALUES (?)", [args])
          admins.add(args)
          telegramBot.sendMessage(chatId, `Admin added: ${args}`)
          break

        case "/remove_admin":
          if (!args) {
            return telegramBot.sendMessage(chatId, "Please provide a Telegram user ID")
          }

          if (args === DEFAULT_ADMIN_ID) {
            return telegramBot.sendMessage(chatId, "Cannot remove default admin")
          }

          await db.run("DELETE FROM admins WHERE telegram_id = ?", [args])
          admins.delete(args)
          telegramBot.sendMessage(chatId, `Admin removed: ${args}`)
          break

        case "/show_contact":
          const dbContacts = await db.all("SELECT * FROM contacts ORDER BY name")
          if (dbContacts.length === 0) {
            telegramBot.sendMessage(chatId, "No contacts found in database")
          } else {
            let contactList = "<b>Contact List:</b>\n\n"

            const contactsByLetter = {}
            dbContacts.forEach((contact) => {
              const firstLetter = (contact.name || "Unknown")[0].toUpperCase()
              if (!contactsByLetter[firstLetter]) {
                contactsByLetter[firstLetter] = []
              }
              contactsByLetter[firstLetter].push(contact)
            })

            const letters = Object.keys(contactsByLetter).sort()
            letters.forEach((letter) => {
              contactList += `<b>${letter}</b>\n`
              contactsByLetter[letter].forEach((contact, index) => {
                contactList += `${index + 1}. ${contact.name || "Unknown"} (${contact.phone})\n`
              })
              contactList += "\n"
            })

            const chunks = splitMessage(contactList)
            for (const chunk of chunks) {
              await telegramBot.sendMessage(chatId, chunk, { parse_mode: "HTML" })
            }
          }
          break

        case "/show_admin":
          const adminList = Array.from(admins)
          if (adminList.length === 0) {
            telegramBot.sendMessage(chatId, "No admins found")
          } else {
            let adminListText = "<b>Admin List:</b>\n\n"
            adminList.forEach((adminId, index) => {
              const isDefault = adminId === DEFAULT_ADMIN_ID ? " (Super Admin)" : ""
              adminListText += `${index + 1}. ${adminId}${isDefault}\n`
            })
            telegramBot.sendMessage(chatId, adminListText, { parse_mode: "HTML" })
          }
          break

        case "/show_user":
          try {
            telegramBot.sendMessage(chatId, "Fetching group members...")

            const chatAdmins = await telegramBot.getChatAdministrators(TELEGRAM_GROUP_ID)

            let userListText = "<b>Telegram Group Users:</b>\n\n"
            chatAdmins.forEach((member, index) => {
              const user = member.user
              const name = user.first_name + (user.last_name ? ` ${user.last_name}` : "")
              userListText += `${index + 1}. ${name} (${user.id})${member.status === "creator" ? " (Group Creator)" : ""}\n`
            })

            telegramBot.sendMessage(chatId, userListText, { parse_mode: "HTML" })

            telegramBot.sendMessage(
              chatId,
              "Note: Only group administrators are shown. Telegram Bot API doesn't allow bots to get a complete list of group members.",
              { parse_mode: "HTML" },
            )
          } catch (error) {
            telegramBot.sendMessage(chatId, `Error fetching group members: ${error.message}`)
          }
          break

        default:
          telegramBot.sendMessage(chatId, "Unknown command")
      }

      return
    }

    if (msg.reply_to_message && chatId.toString() === TELEGRAM_GROUP_ID) {
      if (!admins.has(userId)) {
        telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Anda tidak memiliki izin untuk membalas chat ini", {
          reply_to_message_id: msg.message_id,
          message_thread_id: TELEGRAM_TOPIC_ID,
          parse_mode: "HTML",
        })
        return
      }

      const originalText = msg.reply_to_message.text || msg.reply_to_message.caption || ""
      const phoneMatch = originalText.match(/No HP:[\s\S]*?(\d+)/)

      if (phoneMatch && phoneMatch[1]) {
        const phone = phoneMatch[1]

        if (msg.text) {
          await sendWhatsAppMessage(phone, msg.text, msg.message_id)
        } else if (msg.photo) {
          const photo = msg.photo[msg.photo.length - 1]
          const buffer = await downloadTelegramFile(photo.file_id)
          const base64Data = buffer.toString("base64")

          await whatsappClient.sendMessage(
            `${phone}@c.us`,
            new MessageMedia("image/jpeg", base64Data, "image.jpg", msg.caption),
          )

          const sentMsg = await telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Photo sent to ${phone}`, {
            reply_to_message_id: msg.message_id,
            message_thread_id: TELEGRAM_TOPIC_ID,
            parse_mode: "HTML",
          })

          setTimeout(() => {
            telegramBot
              .deleteMessage(TELEGRAM_GROUP_ID, sentMsg.message_id)
              .catch((err) => console.error("Error deleting message:", err))
          }, 5000)
        } else if (msg.video) {
          try {
            const buffer = await downloadTelegramFile(msg.video.file_id)

            const videoPath = path.join(tempDir, `video_${Date.now()}.mp4`)
            fs.writeFileSync(videoPath, buffer)

            const videoBuffer = fs.readFileSync(videoPath)
            const base64Data = videoBuffer.toString("base64")

            await whatsappClient.sendMessage(
              `${phone}@c.us`,
              new MessageMedia("video/mp4", base64Data, "video.mp4", msg.caption),
            )

            fs.unlinkSync(videoPath)

            const sentMsg = await telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Video sent to ${phone}`, {
              reply_to_message_id: msg.message_id,
              message_thread_id: TELEGRAM_TOPIC_ID,
              parse_mode: "HTML",
            })

            setTimeout(() => {
              telegramBot
                .deleteMessage(TELEGRAM_GROUP_ID, sentMsg.message_id)
                .catch((err) => console.error("Error deleting message:", err))
            }, 5000)
          } catch (error) {
            console.error("Error sending video:", error)
            telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Error sending video: ${error.message}`, {
              reply_to_message_id: msg.message_id,
              message_thread_id: TELEGRAM_TOPIC_ID,
              parse_mode: "HTML",
            })
          }
        } else if (msg.document) {
          const buffer = await downloadTelegramFile(msg.document.file_id)
          const base64Data = buffer.toString("base64")
          const mimeType = msg.document.mime_type || "application/octet-stream"

          await whatsappClient.sendMessage(
            `${phone}@c.us`,
            new MessageMedia(mimeType, base64Data, msg.document.file_name, msg.caption),
          )

          const sentMsg = await telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Document sent to ${phone}`, {
            reply_to_message_id: msg.message_id,
            message_thread_id: TELEGRAM_TOPIC_ID,
            parse_mode: "HTML",
          })

          setTimeout(() => {
            telegramBot
              .deleteMessage(TELEGRAM_GROUP_ID, sentMsg.message_id)
              .catch((err) => console.error("Error deleting message:", err))
          }, 5000)
        } else if (msg.audio || msg.voice) {
          const audioMsg = msg.audio || msg.voice
          const buffer = await downloadTelegramFile(audioMsg.file_id)
          const base64Data = buffer.toString("base64")
          const mimeType = audioMsg.mime_type || "audio/ogg"

          await whatsappClient.sendMessage(
            `${phone}@c.us`,
            new MessageMedia(mimeType, base64Data, "audio.ogg", msg.caption),
          )

          const sentMsg = await telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Audio sent to ${phone}`, {
            reply_to_message_id: msg.message_id,
            message_thread_id: TELEGRAM_TOPIC_ID,
            parse_mode: "HTML",
          })

          setTimeout(() => {
            telegramBot
              .deleteMessage(TELEGRAM_GROUP_ID, sentMsg.message_id)
              .catch((err) => console.error("Error deleting message:", err))
          }, 5000)
        }
      } else {
        telegramBot.sendMessage(TELEGRAM_GROUP_ID, "Could not find phone number in the original message", {
          reply_to_message_id: msg.message_id,
          message_thread_id: TELEGRAM_TOPIC_ID,
          parse_mode: "HTML",
        })
      }
    }
  } catch (error) {
    console.error("Error handling Telegram message:", error)
    telegramBot.sendMessage(TELEGRAM_GROUP_ID, `Error handling Telegram message: ${error.message}`, {
      message_thread_id: TELEGRAM_TOPIC_ID,
      parse_mode: "HTML",
    })
  }
})

process.on("SIGINT", async () => {
  console.log("Received SIGINT. Closing connections and exiting...")

  try {
    if (db) {
      await db.close()
      console.log("Database connection closed")
    }

    if (whatsappClient) {
      await whatsappClient.destroy()
      console.log("WhatsApp client destroyed")
    }
  } catch (error) {
    console.error("Error during shutdown:", error)
  }

  process.exit(0)
})

async function start() {
  try {
    await initializeDatabase()
    console.log("Database initialized")

    whatsappClient.initialize()
    console.log("WhatsApp client initializing...")

    console.log("Telegram bot started")
  } catch (error) {
    console.error("Error starting application:", error)
  }
}

start()