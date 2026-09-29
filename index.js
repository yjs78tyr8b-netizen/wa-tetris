import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import fs from "fs";

const COINS_FILE = "./coins.json";
const STARTING_COINS = 1000;
const DAILY_COINS = 500;

function loadCoins() {
  if (!fs.existsSync(COINS_FILE)) {
    fs.writeFileSync(COINS_FILE, "{}");
  }

  return JSON.parse(fs.readFileSync(COINS_FILE, "utf8"));
}

function saveCoins(data) {
  fs.writeFileSync(
    COINS_FILE,
    JSON.stringify(data, null, 2)
  );
}

function getUser(coins, jid) {
  if (!coins[jid]) {
    coins[jid] = {
      coins: STARTING_COINS,
      lastDaily: 0
    };

    saveCoins(coins);
  }

  return coins[jid];
}

function playSlot() {
  const symbols = ["🍒", "🍋", "🍊", "🍉", "⭐", "7️⃣"];

  return [
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];
}

function calculatePrize(result, bet) {
  if (result[0] === result[1] && result[1] === result[2]) {
    if (result[0] === "7️⃣") return bet * 10;
    if (result[0] === "⭐") return bet * 7;
    return bet * 5;
  }

  if (
    result[0] === result[1] ||
    result[1] === result[2] ||
    result[0] === result[2]
  ) {
    return bet * 2;
  }

  return 0;
}

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Scan QR berikut dengan WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ BOT WHATSAPP TERHUBUNG!");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : 0) !== DisconnectReason.loggedOut;

      console.log("❌ Koneksi terputus.");

      if (shouldReconnect) {
        console.log("🔄 Menghubungkan kembali...");
        startBot();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages[0];

    if (!msg?.message) return;
    if (msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    if (!jid || jid.endsWith("@g.us")) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const command = text.trim().toLowerCase();

    const coins = loadCoins();
    const user = getUser(coins, jid);

    if (command === "/menu") {
      await sock.sendMessage(jid, {
        text:
`🎰 *WA TETRIS SLOT*

🪙 /saldo
🎰 /slot 10
🎁 /daily
🏆 /top

Modal awal: ${STARTING_COINS} koin

Koin ini hanya virtual dan tidak memiliki nilai uang.`
      });
    }

    else if (command === "/saldo") {
      await sock.sendMessage(jid, {
        text: `🪙 Saldo kamu: *${user.coins} koin*`
      });
    }

    else if (command === "/daily") {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      if (now - user.lastDaily < oneDay) {
        const remaining =
          oneDay - (now - user.lastDaily);

        const hours = Math.ceil(
          remaining / (60 * 60 * 1000)
        );

        await sock.sendMessage(jid, {
          text: `⏳ Kamu sudah mengambil bonus hari ini.\nCoba lagi sekitar ${hours} jam lagi.`
        });

        return;
      }

      user.coins += DAILY_COINS;
      user.lastDaily = now;

      saveCoins(coins);

      await sock.sendMessage(jid, {
        text:
`🎁 *DAILY BONUS*

+${DAILY_COINS} 🪙 koin

Saldo sekarang:
*${user.coins} koin*`
      });
    }

    else if (command.startsWith("/slot")) {
      const parts = command.split(/\s+/);
      const bet = Number(parts[1]);

      if (!Number.isInteger(bet) || bet <= 0) {
        await sock.sendMessage(jid, {
          text: "❌ Contoh: */slot 10*"
        });

        return;
      }

      if (bet > user.coins) {
        await sock.sendMessage(jid, {
          text:
`❌ Koin tidak cukup.

Saldo: ${user.coins}
Taruhan: ${bet}`
        });

        return;
      }

      if (bet > 100000) {
        await sock.sendMessage(jid, {
          text: "❌ Maksimal taruhan adalah 100.000 koin."
        });

        return;
      }

      user.coins -= bet;

      const result = playSlot();
      const prize = calculatePrize(result, bet);

      user.coins += prize;

      saveCoins(coins);

      let resultText = "";

      if (prize === 0) {
        resultText = "💥 ZONK!";
      } else if (prize === bet * 2) {
        resultText = `✨ 2 MATCH! +${prize} koin`;
      } else {
        resultText = `🎉 JACKPOT! +${prize} koin`;
      }

      await sock.sendMessage(jid, {
        text:
`🎰 *SLOT MACHINE*

┌─────────────┐
│ ${result.join(" │ ")} │
└─────────────┘

Taruhan: ${bet} 🪙

${resultText}

💰 Saldo:
*${user.coins} koin*`
      });
    }

    else if (command === "/top") {
      const ranking = Object.entries(coins)
        .sort((a, b) => b[1].coins - a[1].coins)
        .slice(0, 10);

      let textTop = "🏆 *TOP 10 KOIN*\n\n";

      ranking.forEach(([id, data], index) => {
        const name = id.split("@")[0];

        textTop +=
          `${index + 1}. ${name} — ${data.coins} 🪙\n`;
      });

      await sock.sendMessage(jid, {
        text: textTop
      });
    }
  });
}

startBot();
