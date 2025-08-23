const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// SHOPIFY VARIJABLE IZ ENV
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET; 

app.use(bodyParser.json());

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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

const api = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2024-04`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

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

async function fetchOrdersByCustomerId(customerId) {
  const { data } = await api.get(`/orders.json`, {
    params: { status: "any", limit: 50, customer_id: customerId },
  });
  return Array.isArray(data?.orders) ? data.orders : [];
}

function getLatestFulfillmentDate(order) {
  const list = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  if (!list.length) return null;
  return list
    .map(f => new Date(f.created_at))
    .sort((a, b) => b - a)[0];
}

app.post("/order-status", async (req, res) => {
  const { email, first_name, last_name } = req.body || {};

  if (!email && (!first_name || !last_name)) {
    return res.status(200).json({
      message: "Molimo unesite ime i prezime ili email adresu koju ste koristili tokom porudžbine."
    });
  }

  try {
    const customers = await findCustomers({ email, first_name, last_name });
    if (!customers.length) {
      return res.status(200).json({
        message: "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

    const allOrdersArrays = await Promise.all(
      customers.map(c => fetchOrdersByCustomerId(c.id))
    );
    const orders = allOrdersArrays.flat();

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
        message: "Nismo pronašli porudžbinu za unete podatke. Proverite email koji ste koristili tokom porudžbine."
      });
    }

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
      message: "Vaša porudžbina je primljena i u obradi je. Rok izrade je obično 5–7 radnih dana."
    });
  } catch (err) {
    console.error("Order status error:", err?.response?.status || err?.message);
    return res.status(500).json({
      message: "Došlo je do greške pri obradi zahteva. Pokušajte kasnije ili nas kontaktirajte na 063/497 489."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server je pokrenut na portu ${PORT}`);
});
