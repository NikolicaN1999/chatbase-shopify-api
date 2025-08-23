const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// === Direktno u kodu (string konstante) ===
const SHOPIFY_STORE   = "printstick.myshopify.com";         // ← zameni po potrebi
const SHOPIFY_TOKEN   = "shpat_xxxxxxxxxxxxxxxxxxxxxxxxx";   // ← tvoj Admin API token
const INTERNAL_SECRET = "k7js9hf2n39sdf82h1ns0qpa";         // ← tvoj interni secret

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

/** Normalizacija (ćirilica→latinica → bez dijakritika → lower) */
function normalize(text) {
  return cyrToLat(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

// Prekonfigurisani REST klijent
const api = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2024-04`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

/** 1) Nađi kupce po emailu ili imenu/prezimenu (Customers Search API) */
async function findCustomers({ email, first_name, last_name }) {
  if (email) {
    const { data } = await api.get(`/customers/search.json`, {
      params: { query: `email:${email}` },
    });
    return Array.isArray(data?.customers) ? data.customers : [];
  }
  const parts = [];
  if (first_name) parts.push(`first_name:${first_name}`);
  if (last_name)  parts.push(`last_name:${last_name}`);
  if (!parts.length) return [];
  const { data } = await api.get(`/customers/search.json`, {
    params: { query: parts.join(" ") },
  });
  return Array.isArray(data?.customers) ? data.customers : [];
}

/** 2) Učitaj porudžbine za customer_id (status=any, limit=50) */
async function fetchOrdersByCustomerId(customerId) {
  const { data } = await api.get(`/orders.json`, {
    params: { status: "any", limit: 50, customer_id: customerId },
  });
  return Array.isArray(data?.orders) ? data.orders : [];
}

/** Najnoviji fulfillment timestamp (ako postoji) */
function getLatestFulfillmentDate(order) {
  const list = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  if (!list.length) return null;
  return list
    .map(f => new Date(f.created_at))
    .sort((a, b) => b - a)[0];
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
    // 1) Kandidati kupaca
    const customers = await findCustomers({ email, first_name, last_name });
    if (!customers.length) {
      return res.status(200).json({
        message:
          "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    // 2) Skupi porudžbine svih kandidata
    const allOrdersArrays = await Promise.all(
      customers.map(c => fetchOrdersByCustomerId(c.id))
    );
    const orders = allOrdersArrays.flat();

    // 3) Strogo filtriranje po emailu / imenu (normalize) ako je dato
    const nEmail = email ? normalize(email) : null;
    const nFirst = first_name ? normalize(first_name) : null;
    const nLast  = last_name  ? normalize(last_name)  : null;

    const matches = orders.filter(order => {
      const emailMatch = nEmail ? normalize(order.email) === nEmail : true;
      const fnMatch = nFirst ? normalize(order.customer?.first_name) === nFirst : true;
      const lnMatch = nLast  ? normalize(order.customer?.last_name)  === nLast  : true;
      return emailMatch && fnMatch && lnMatch;
    });

    if (!matches.length) {
      return res.status(200).json({
        message:
          "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    // 4) Najnovija porudžbina po created_at
    const lastOrder = matches.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )[0];

    const latestFulfillmentAt = getLatestFulfillmentDate(lastOrder);

    if (lastOrder.fulfillment_status === "fulfilled" || latestFulfillmentAt) {
      const formatted = latestFulfillmentAt
        ? latestFulfillmentAt.toLocaleDateString("sr-RS")
        : "nepoznat datum";
      return res.status(200).json({
        message: `Vaša porudžbina je poslata ${formatted} 📦 Očekujte isporuku uskoro.`
      });
    }

    return res.status(200).json({
      message:
        "Vaša porudžbina je primljena i u obradi je. Rok izrade je obično 5–7 radnih dana."
    });
  } catch (err) {
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
