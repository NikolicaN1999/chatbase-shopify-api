
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

app.use(express.json());

// --- Prosta zaštita endpointa: zahteva interni secret header ---
app.use((req, res, next) => {
  const hdr = req.get("x-internal-secret");
  if (!INTERNAL_SECRET || hdr !== INTERNAL_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
});

/** Ćirilica → latinica */
function cyrToLat(text) {
  const map = {
    А:"A", а:"a", Б:"B", б:"b", В:"V", в:"v",
    Г:"G", г:"g", Д:"D", д:"d", Ђ:"Đ", ђ:"đ",
    Е:"E", е:"e", Ж:"Ž", ж:"ž", З:"Z", з:"z",
    И:"I", и:"i", Ј:"J", ј:"j", К:"K", к:"k",
    Л:"L", л:"l", Љ:"Lj", љ:"lj", М:"M", м:"m",
    Н:"N", н:"n", Њ:"Nj", њ:"nj", О:"O", о:"o",
    П:"P", п:"p", Р:"R", р:"r", С:"S", с:"s",
    Т:"T", т:"t", Ћ:"Ć", ћ:"ć", У:"U", у:"u",
    Ф:"F", ф:"f", Х:"H", х:"h", Ц:"C", ц:"c",
    Ч:"Č", ч:"č", Џ:"Dž", џ:"dž", Ш:"Š", ш:"š"
  };
  return (text || "").split("").map(ch => map[ch] || ch).join("");
}

/** Normalizacija */
function normalize(text) {
  return cyrToLat(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

app.post("/order-status", async (req, res) => {
  const { email, first_name, last_name } = req.body || {};

  // Validacija unosa
  if (!email && (!first_name || !last_name)) {
    return res.status(200).json({
      message:
        "Molimo unesite ime i prezime ili email adresu koju ste koristili tokom porudžbine."
    });
  }

  try {
    // Ako postoji email, filtriraj već na Shopify strani (manje podataka = bezbednije/brže)
    const url = email
      ? `https://${SHOPIFY_STORE}/admin/api/2024-04/orders.json?status=any&limit=50&email=${encodeURIComponent(email)}`
      : `https://${SHOPIFY_STORE}/admin/api/2024-04/orders.json?status=any&limit=250`;

    const { data } = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const orders = Array.isArray(data?.orders) ? data.orders : [];

    // Dodatno filtriranje po imenu/prezimenu ako su prosleđeni
    const matches = orders.filter((order) => {
      const emailMatch = email ? (order.email || "").toLowerCase() === email.toLowerCase() : true;
      const fnMatch = first_name ? normalize(order.customer?.first_name) === normalize(first_name) : true;
      const lnMatch = last_name ?  normalize(order.customer?.last_name)  === normalize(last_name)  : true;
      return emailMatch && fnMatch && lnMatch;
    });

    if (matches.length === 0) {
      return res.status(200).json({
        message:
          "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    // Uzimamo najnoviju porudžbinu
    const lastOrder = matches.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )[0];

    const status = lastOrder.fulfillment_status;
    if (status === "fulfilled") {
      const sentAt = lastOrder.fulfillments?.[0]?.created_at;
      const formattedDate = sentAt
        ? new Date(sentAt).toLocaleDateString("sr-RS")
        : "nepoznat datum";
      return res.status(200).json({
        message: `Vaša porudžbina je poslata ${formattedDate} 📦 Očekujte isporuku uskoro.`
      });
    }

    return res.status(200).json({
      message:
        "Vaša porudžbina je primljena i u obradi je. Rok izrade je obično 5–7 radnih dana."
    });
  } catch (err) {
    // Ne loguj ceo objekat (da ne iscure podaci); loguj minimalno
    console.error("Order status error:", err?.response?.status || err?.message);
    return res.status(500).json({
      message:
        "Došlo je do greške pri obradi zahteva. Pokušajte kasnije ili nas kontaktirajte na 063/497 489."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});
