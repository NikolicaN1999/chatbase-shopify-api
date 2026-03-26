const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// === ENV varijable ===
const SHOPIFY_STORE   = process.env.SHOPIFY_STORE;   // npr. printstick.myshopify.com
const SHOPIFY_TOKEN   = process.env.SHOPIFY_TOKEN;   // Admin API token sa read_customers + read_orders
const INTERNAL_SECRET = process.env.INTERNAL_SECRET; // opciono

app.use(express.json());

// Zaštita endpointa ako je INTERNAL_SECRET postavljen
app.use((req, res, next) => {
  if (INTERNAL_SECRET) {
    const hdr = req.get("x-internal-secret");
    if (hdr !== INTERNAL_SECRET) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  }
  next();
});

// Ćirilica → latinica
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

function normalize(text) {
  return cyrToLat(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Health ruta
app.get("/_health", (req, res) => {
  res.json({
    store_ok: typeof SHOPIFY_STORE === "string" && SHOPIFY_STORE.includes(".myshopify.com"),
    token_set: !!(SHOPIFY_TOKEN && SHOPIFY_TOKEN.length > 10),
    secret_required: !!INTERNAL_SECRET
  });
});

// Shopify REST klijent
const api = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2024-04`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

api.interceptors.response.use(
  r => r,
  err => {
    const status = err?.response?.status;
    const errors = err?.response?.data?.errors;
    console.error("Shopify API error:", { status, errors, msg: err?.message });
    return Promise.reject(err);
  }
);

// 1) Pronađi kupce po emailu ili imenu/prezimenu
async function findCustomers({ email, first_name, last_name }) {
  if (email) {
    const { data } = await api.get(`/customers/search.json`, {
      params: { query: `email:${email}` },
    });
    return Array.isArray(data?.customers) ? data.customers : [];
  }

  const parts = [];
  if (first_name) parts.push(`first_name:${first_name}`);
  if (last_name) parts.push(`last_name:${last_name}`);
  if (!parts.length) return [];

  const { data } = await api.get(`/customers/search.json`, {
    params: { query: parts.join(" ") },
  });

  return Array.isArray(data?.customers) ? data.customers : [];
}

// 2) Učitaj sve porudžbine za customer_id
async function fetchOrdersByCustomerId(customerId) {
  const { data } = await api.get(`/orders.json`, {
    params: {
      customer_id: customerId,
      status: "any",
      fulfillment_status: "any",
      limit: 250,
      fields: "id,name,created_at,fulfillment_status,email,customer,fulfillments"
    }
  });

  return Array.isArray(data?.orders) ? data.orders : [];
}

// Najnoviji fulfillment datum
function getLatestFulfillmentDate(order) {
  const list = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  if (!list.length) return null;

  return list
    .map(f => new Date(f.created_at))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => b - a)[0] || null;
}

app.post("/order-status", async (req, res) => {
  const { email, first_name, last_name } = req.body || {};

  if (!email && (!first_name || !last_name)) {
    return res.status(200).json({
      message: "Molimo unesite ime i prezime ili email adresu koju ste koristili tokom porudžbine."
    });
  }

  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
    return res.status(500).json({
      message: "Konfiguracija servera nije kompletna (STORE/TOKEN)."
    });
  }

  try {
    // 1) Pronađi kupca
    const customers = await findCustomers({ email, first_name, last_name });

    if (!customers.length) {
      return res.status(200).json({
        message: "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    // 2) Učitaj sve porudžbine svih kandidata
    const allOrdersArrays = await Promise.all(
      customers.map(c => fetchOrdersByCustomerId(c.id))
    );
    const orders = allOrdersArrays.flat();

    if (!orders.length) {
      return res.status(200).json({
        message: "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    // 3) Strogo filtriranje
    const nEmail = email ? normalize(email) : null;
    const nFirst = first_name ? normalize(first_name) : null;
    const nLast  = last_name ? normalize(last_name) : null;

    const matches = orders.filter(order => {
      const emailMatch = nEmail ? normalize(order.email) === nEmail : true;
      const fnMatch = nFirst ? normalize(order.customer?.first_name) === nFirst : true;
      const lnMatch = nLast ? normalize(order.customer?.last_name) === nLast : true;
      return emailMatch && fnMatch && lnMatch;
    });

    if (!matches.length) {
      return res.status(200).json({
        message: "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    // 4) Uzmi najnoviju porudžbinu
    const lastOrder = matches.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )[0];

    const latestFulfillmentAt = getLatestFulfillmentDate(lastOrder);

    if (lastOrder.fulfillment_status === "fulfilled" || latestFulfillmentAt) {
      const formatted = latestFulfillmentAt
        ? latestFulfillmentAt.toLocaleDateString("sr-RS")
        : "u prethodnom periodu";

      return res.status(200).json({
        status: "fulfilled",
        message: `Vaša porudžbina je poslata ${formatted} 📦 Očekujte isporuku uskoro.`
      });
    }

    return res.status(200).json({
      status: "processing",
      message: "Vaša porudžbina je uspešno primljena i trenutno je u obradi. ✨ Rok izrade je u proseku 5–7 radnih dana, jer izrađujemo personalizovane stikere po meri."
    });

  } catch (err) {
    const status = err?.response?.status || 500;
    const errors = err?.response?.data?.errors;

    console.error("Order status error:", {
      status,
      errors,
      msg: err?.message
    });

    return res.status(status).json({
      message:
        status === 401 ? "Shopify auth problem (proverite Admin API token)." :
        status === 403 ? "Shopify permissions problem (dodajte read_customers + read_orders i reinstalirajte app)." :
        status === 404 ? "Shopify endpoint nije pronađen (proverite STORE domen)." :
        "Došlo je do greške pri obradi zahteva. Pokušajte kasnije ili nas kontaktirajte na kontakt@printstick.rs."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server je pokrenut na portu ${PORT}`);
});
